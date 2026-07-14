import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { createLogger } from '@ecommerce/logger';
import { UserRole, successResponse, errorResponse, buildPagination, buildPaginatedResult } from '@ecommerce/shared';
import { toHttpError } from '@ecommerce/errors';
import { Permission, requirePermission } from '@ecommerce/rbac';

const logger = createLogger({ service: 'admin-service', level: process.env.LOG_LEVEL ?? 'info' });

// admin_svc has SELECT on all schemas — used for cross-service reporting
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://admin_svc:admin_pass@localhost:5432/ecommerce',
  max: 10,
});

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  const extractUser = (req: Request, _res: Response, next: NextFunction) => {
    const userId = req.headers['x-user-id'] as string;
    const userRole = req.headers['x-user-role'] as string;
    const userEmail = req.headers['x-user-email'] as string;
    const agentId = req.headers['x-agent-id'] as string | undefined;
    if (userId && userRole) {
      req.user = { id: userId, email: userEmail, role: userRole as UserRole, agentId };
    }
    next();
  };

  app.use(extractUser);

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'admin-service' }));

  // Dashboard summary
  app.get('/api/admin/dashboard', requirePermission(Permission.READ_DASHBOARD), async (_req, res, next) => {
    try {
      const [users, orders, revenue, agents] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM auth.users WHERE role = 'user'`),
        pool.query(`SELECT COUNT(*), status FROM "order".orders GROUP BY status`),
        pool.query(`SELECT COALESCE(SUM(total_amount), 0) as total FROM "order".orders WHERE status IN ('PAID','COMPLETED')`),
        pool.query(`SELECT COUNT(*), approval_status FROM auth.agent_profiles GROUP BY approval_status`),
      ]);

      res.json(successResponse({
        totalUsers: parseInt(users.rows[0].count, 10),
        totalRevenue: parseFloat(revenue.rows[0].total),
        ordersByStatus: orders.rows,
        agentsByStatus: agents.rows,
      }));
    } catch (err) { next(err); }
  });

  // User management
  app.get('/api/admin/users', requirePermission(Permission.READ_ALL_USERS), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const [rows, count] = await Promise.all([
        pool.query(`SELECT id, email, role, first_name, last_name, is_active, created_at FROM auth.users ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
        pool.query(`SELECT COUNT(*) FROM auth.users`),
      ]);
      res.json(successResponse(buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit)));
    } catch (err) { next(err); }
  });

  // Order management
  app.get('/api/admin/orders', requirePermission(Permission.READ_ALL_ORDERS), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT o.*, u.email as user_email FROM "order".orders o
           JOIN auth.users u ON o.user_id = u.id
           ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        pool.query(`SELECT COUNT(*) FROM "order".orders`),
      ]);
      res.json(successResponse(buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit)));
    } catch (err) { next(err); }
  });

  // Product moderation — pending only (used by approval workflow)
  app.get('/api/admin/products/pending', requirePermission(Permission.MODERATE_PRODUCT), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const [rows, count] = await Promise.all([
        pool.query(`SELECT * FROM product.products WHERE status = 'PENDING_APPROVAL' ORDER BY created_at ASC LIMIT $1 OFFSET $2`, [limit, offset]),
        pool.query(`SELECT COUNT(*) FROM product.products WHERE status = 'PENDING_APPROVAL'`),
      ]);
      res.json(successResponse(buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit)));
    } catch (err) { next(err); }
  });

  // All products with optional ?status= and ?agentId= filters
  app.get('/api/admin/products', requirePermission(Permission.READ_ANY_PRODUCT), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const q = req.query as Record<string, string>;
      const conditions: string[] = [];
      const params: unknown[] = [limit, offset];

      if (q.status)  { conditions.push(`p.status = $${params.length + 1}`);   params.push(q.status); }
      if (q.agentId) { conditions.push(`p.agent_id = $${params.length + 1}`); params.push(q.agentId); }
      if (q.search)  {
        conditions.push(`(p.name ILIKE $${params.length + 1} OR p.sku ILIKE $${params.length + 1})`);
        params.push(`%${q.search}%`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const countParams = params.slice(2); // exclude limit/offset

      const [rows, count, statusSummary] = await Promise.all([
        pool.query(
          `SELECT p.*, ap.business_name AS agent_name,
                  i.quantity_available
           FROM product.products p
           LEFT JOIN auth.agent_profiles ap ON ap.id = p.agent_id
           LEFT JOIN inventory.inventories i ON i.product_id = p.id
           ${where}
           ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
          params,
        ),
        pool.query(
          `SELECT COUNT(*) FROM product.products p ${where}`,
          countParams,
        ),
        pool.query(
          `SELECT status, COUNT(*) FROM product.products ${q.agentId ? 'WHERE agent_id = $1' : ''}
           GROUP BY status`,
          q.agentId ? [q.agentId] : [],
        ),
      ]);

      res.json(successResponse({
        ...buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit),
        statusSummary: statusSummary.rows,
      }));
    } catch (err) { next(err); }
  });

  // Agent detail stats (for agent detail page)
  app.get('/api/admin/agents/:agentId/stats', requirePermission(Permission.READ_ALL_AGENTS), async (req, res, next) => {
    try {
      const { agentId } = req.params;
      const [profile, productCounts, salesStats, recentOrders] = await Promise.all([
        pool.query(
          `SELECT ap.*, u.email, u.first_name, u.last_name, u.is_active
           FROM auth.agent_profiles ap
           JOIN auth.users u ON u.id = ap.user_id
           WHERE ap.id = $1`,
          [agentId],
        ),
        pool.query(
          `SELECT status, COUNT(*) FROM product.products WHERE agent_id = $1 GROUP BY status`,
          [agentId],
        ),
        pool.query(
          `SELECT COUNT(oi.id)::int AS order_count,
                  COALESCE(SUM(oi.total_price), 0)::int AS total_sales,
                  COALESCE(SUM(oi.total_price * ap.commission_rate / 100), 0)::int AS commission_earned
           FROM "order".order_items oi
           JOIN "order".orders o ON o.id = oi.order_id AND o.status IN ('PAID','COMPLETED')
           JOIN auth.agent_profiles ap ON ap.id = oi.agent_id
           WHERE oi.agent_id = $1`,
          [agentId],
        ),
        pool.query(
          `SELECT o.id, o.status, o.total_amount, o.created_at, u.email AS user_email
           FROM "order".orders o
           JOIN auth.users u ON u.id = o.user_id
           WHERE o.id IN (
             SELECT DISTINCT order_id FROM "order".order_items WHERE agent_id = $1
           )
           ORDER BY o.created_at DESC LIMIT 5`,
          [agentId],
        ),
      ]);

      if (!profile.rows[0]) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } });
      }

      res.json(successResponse({
        profile: profile.rows[0],
        productCounts: productCounts.rows,
        sales: salesStats.rows[0],
        recentOrders: recentOrders.rows,
      }));
    } catch (err) { next(err); }
  });

  // Commission settings
  app.patch('/api/admin/agents/:agentId/commission', requirePermission(Permission.SET_COMMISSION), async (req, res, next) => {
    try {
      const { commissionRate } = req.body;
      await pool.query(
        `UPDATE auth.agent_profiles SET commission_rate = $2, updated_at = NOW() WHERE id = $1`,
        [req.params.agentId, commissionRate],
      );
      res.json(successResponse({ message: 'Commission rate updated' }));
    } catch (err) { next(err); }
  });

  // Revenue + orders trend for last 30 days
  app.get('/api/admin/analytics/revenue', requirePermission(Permission.READ_REPORTS), async (_req, res, next) => {
    try {
      const rows = await pool.query(`
        SELECT
          TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS date,
          COALESCE(SUM(total_amount), 0)::int        AS revenue,
          COUNT(*)::int                               AS orders
        FROM "order".orders
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `);
      res.json(successResponse(rows.rows));
    } catch (err) { next(err); }
  });

  // User toggle active
  app.patch('/api/admin/users/:userId/status', requirePermission(Permission.UPDATE_ANY_USER), async (req, res, next) => {
    try {
      const { isActive } = req.body;
      await pool.query(
        `UPDATE auth.users SET is_active = $2, updated_at = NOW() WHERE id = $1`,
        [req.params.userId, isActive],
      );
      res.json(successResponse({ message: 'User status updated' }));
    } catch (err) { next(err); }
  });

  // Delivery groups overview
  app.get('/api/admin/deliveries', requirePermission(Permission.READ_ALL_DELIVERIES), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const statusFilter = (req.query as any).status as string | undefined;
      const where = statusFilter ? `WHERE dg.status = $3` : '';
      const params: unknown[] = statusFilter ? [limit, offset, statusFilter] : [limit, offset];

      const [rows, count, statusSummary] = await Promise.all([
        pool.query(
          `SELECT dg.id, dg.order_id, dg.agent_id, dg.status, dg.courier_name,
                  dg.tracking_number, dg.shipping_fee, dg.shipped_at, dg.delivered_at,
                  dg.created_at, ap.business_name AS agent_name
           FROM delivery.delivery_groups dg
           LEFT JOIN auth.agent_profiles ap ON ap.id = dg.agent_id
           ${where}
           ORDER BY dg.created_at DESC LIMIT $1 OFFSET $2`,
          params,
        ),
        pool.query(`SELECT COUNT(*) FROM delivery.delivery_groups dg ${where}`, statusFilter ? [statusFilter] : []),
        pool.query(`SELECT status, COUNT(*) FROM delivery.delivery_groups GROUP BY status`),
      ]);

      res.json(successResponse({
        ...buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit),
        statusSummary: statusSummary.rows,
      }));
    } catch (err) { next(err); }
  });

  // Return requests
  app.get('/api/admin/returns', requirePermission(Permission.READ_ALL_DELIVERIES), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT rr.*, dg.agent_id, ap.business_name AS agent_name
           FROM delivery.return_requests rr
           JOIN delivery.delivery_groups dg ON dg.id = rr.delivery_group_id
           LEFT JOIN auth.agent_profiles ap ON ap.id = dg.agent_id
           ORDER BY rr.created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        pool.query(`SELECT COUNT(*) FROM delivery.return_requests`),
      ]);
      res.json(successResponse(buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit)));
    } catch (err) { next(err); }
  });

  // Analytics: agent sales ranking
  app.get('/api/admin/analytics/agents', requirePermission(Permission.READ_REPORTS), async (_req, res, next) => {
    try {
      const rows = await pool.query(`
        SELECT ap.id, ap.business_name,
               COUNT(oi.id)::int        AS order_count,
               COALESCE(SUM(oi.total_price), 0)::int AS total_sales
        FROM auth.agent_profiles ap
        LEFT JOIN "order".order_items oi ON oi.agent_id = ap.id
        LEFT JOIN "order".orders o       ON o.id = oi.order_id AND o.status IN ('PAID','COMPLETED')
        WHERE ap.approval_status = 'APPROVED'
        GROUP BY ap.id, ap.business_name
        ORDER BY total_sales DESC
        LIMIT 10
      `);
      res.json(successResponse(rows.rows));
    } catch (err) { next(err); }
  });

  // Analytics: low-stock products
  app.get('/api/admin/analytics/inventory', requirePermission(Permission.READ_ALL_INVENTORY), async (_req, res, next) => {
    try {
      const rows = await pool.query(`
        SELECT i.product_id, p.name AS product_name, p.sku, i.quantity_available, i.quantity_reserved
        FROM inventory.inventories i
        JOIN product.products p ON p.id = i.product_id
        WHERE i.quantity_available <= 10
        ORDER BY i.quantity_available ASC
        LIMIT 20
      `);
      res.json(successResponse(rows.rows));
    } catch (err) { next(err); }
  });

  // Analytics: new user registrations per day (last 30 days)
  app.get('/api/admin/analytics/users', requirePermission(Permission.READ_REPORTS), async (_req, res, next) => {
    try {
      const rows = await pool.query(`
        SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
        FROM auth.users
        WHERE created_at >= NOW() - INTERVAL '30 days' AND role = 'user'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `);
      res.json(successResponse(rows.rows));
    } catch (err) { next(err); }
  });

  // Settlement list (super-admin only)
  app.get('/api/admin/settlements', requirePermission(Permission.READ_SETTLEMENTS), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT ps.id, ps.agent_id, ps.order_id, ps.gross_amount,
                  ps.commission AS commission_amount, ps.net_amount, ps.status, ps.created_at,
                  ap.business_name AS agent_name
           FROM payment.agent_settlements ps
           JOIN auth.agent_profiles ap ON ap.id = ps.agent_id
           ORDER BY ps.created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        pool.query(`SELECT COUNT(*) FROM payment.agent_settlements`),
      ]);
      res.json(successResponse(buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit)));
    } catch (err) { next(err); }
  });

  // Force order status change (admin only)
  app.patch('/api/admin/orders/:orderId/status', requirePermission(Permission.UPDATE_ANY_ORDER_STATUS), async (req, res, next) => {
    try {
      const { status } = req.body;
      const VALID = ['PENDING','CONFIRMED','PAYMENT_PENDING','PAID','SHIPPED','COMPLETED','CANCELLED','REFUNDED'];
      if (!VALID.includes(status)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: `status must be one of: ${VALID.join(', ')}` } });
      }
      const result = await pool.query(
        `UPDATE "order".orders SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id, status`,
        [req.params.orderId, status],
      );
      if (!result.rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
      res.json(successResponse(result.rows[0]));
    } catch (err) { next(err); }
  });

  // Audit log
  app.get('/api/admin/audit-logs', requirePermission(Permission.READ_AUDIT_LOG), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const [rows, count] = await Promise.all([
        pool.query(`SELECT * FROM admin.audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
        pool.query(`SELECT COUNT(*) FROM admin.audit_logs`),
      ]);
      res.json(successResponse(buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit)));
    } catch (err) { next(err); }
  });

  app.use((err: unknown, _req: any, res: any, _next: any) => {
    const { statusCode, code, message, details } = toHttpError(err);
    res.status(statusCode).json(errorResponse(code, message, details));
  });

  const PORT = parseInt(process.env.PORT ?? '3008', 10);
  const server = app.listen(PORT, () => logger.info(`admin-service listening on port ${PORT}`));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
    server.close(async () => { await pool.end(); process.exit(0); });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => { console.error('Failed to start admin-service:', err); process.exit(1); });

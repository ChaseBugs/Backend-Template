import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { createLogger } from '@ecommerce/logger';
import { successResponse, errorResponse, buildPagination, buildPaginatedResult } from '@ecommerce/shared';
import { toHttpError } from '@ecommerce/errors';

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

  const requireAdminRole = (req: any, res: any, next: any) => {
    const role = req.headers['x-user-role'];
    if (!role || !['admin', 'super-admin'].includes(role)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'admin-service' }));

  // Dashboard summary
  app.get('/api/admin/dashboard', requireAdminRole, async (_req, res, next) => {
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
  app.get('/api/admin/users', requireAdminRole, async (req, res, next) => {
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
  app.get('/api/admin/orders', requireAdminRole, async (req, res, next) => {
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

  // Product moderation
  app.get('/api/admin/products/pending', requireAdminRole, async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const [rows, count] = await Promise.all([
        pool.query(`SELECT * FROM product.products WHERE status = 'PENDING_APPROVAL' ORDER BY created_at ASC LIMIT $1 OFFSET $2`, [limit, offset]),
        pool.query(`SELECT COUNT(*) FROM product.products WHERE status = 'PENDING_APPROVAL'`),
      ]);
      res.json(successResponse(buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit)));
    } catch (err) { next(err); }
  });

  // Commission settings
  app.patch('/api/admin/agents/:agentId/commission', requireAdminRole, async (req, res, next) => {
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
  app.get('/api/admin/analytics/revenue', requireAdminRole, async (_req, res, next) => {
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
  app.patch('/api/admin/users/:userId/status', requireAdminRole, async (req, res, next) => {
    try {
      const { isActive } = req.body;
      await pool.query(
        `UPDATE auth.users SET is_active = $2, updated_at = NOW() WHERE id = $1`,
        [req.params.userId, isActive],
      );
      res.json(successResponse({ message: 'User status updated' }));
    } catch (err) { next(err); }
  });

  // Audit log
  app.get('/api/admin/audit-logs', requireAdminRole, async (req, res, next) => {
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

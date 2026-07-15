import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { createAuditLogger, createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { UserRole, successResponse, errorResponse, buildPagination, buildPaginatedResult } from '@ecommerce/shared';
import { BadRequestError, toHttpError } from '@ecommerce/errors';
import { Permission, requirePermission } from '@ecommerce/rbac';
import { createKafka, KafkaProducer } from '@ecommerce/kafka-client';
import { DEFAULT_SYSTEM_HEALTH_TARGETS, parseHealthTargets, SystemHealthMonitor } from './system-health.monitor';
import { buildOrderListFilter, buildUserListFilter } from './admin-list-filters';
import { parseAdminRefundInput } from './admin-refund';

const logger = createLogger({ service: 'admin-service', level: process.env.LOG_LEVEL ?? 'info' });
const auditLogger = createAuditLogger('admin-service', process.env.AUDIT_LOG_FILE ?? 'logs/admin-service/audit.log');
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:3002';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3004';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-internal-token';

// admin_svc has SELECT on all schemas — used for cross-service reporting
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://admin_svc:admin_pass@localhost:5432/ecommerce',
  max: 10,
});

async function bootstrap(): Promise<void> {
  const kafka = createKafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? 'admin-service',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();
  const healthTargets = parseHealthTargets(process.env.SYSTEM_HEALTH_TARGETS ?? DEFAULT_SYSTEM_HEALTH_TARGETS);
  const healthIntervalMs = parseInt(process.env.SYSTEM_HEALTH_INTERVAL_MS ?? '60000', 10);
  if (!Number.isInteger(healthIntervalMs) || healthIntervalMs < 5000) throw new Error('SYSTEM_HEALTH_INTERVAL_MS must be an integer of at least 5000');
  const healthMonitor = new SystemHealthMonitor(
    healthTargets,
    kafkaProducer,
    parseInt(process.env.SYSTEM_HEALTH_FAILURE_THRESHOLD ?? '3', 10),
    undefined,
    logger,
  );
  let healthScanRunning = false;
  const runHealthScan = async () => {
    if (healthScanRunning) return;
    healthScanRunning = true;
    try { await healthMonitor.scan(); }
    catch (error) { logger.error({ error }, 'System health scan failed'); }
    finally { healthScanRunning = false; }
  };
  const isHealthMonitorLeader = process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === '0';
  const healthTimer = isHealthMonitorLeader ? setInterval(runHealthScan, healthIntervalMs) : undefined;
  healthTimer?.unref();
  if (isHealthMonitorLeader) logger.info({ targets: healthTargets.map((target) => target.name) }, 'System health monitor enabled');
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  const observability = createHttpObservability('admin-service', logger);
  app.use(observability.middleware);

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
  app.use((req, res, next) => {
    const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const privileged = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.SUPER_ADMIN;
    if (mutation && privileged && req.originalUrl.startsWith('/api/admin')) {
      const startedAt = Date.now();
      res.once('finish', () => auditLogger.info({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        method: req.method,
        route: req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        requestId: req.headers['x-request-id'],
        traceId: req.headers['x-trace-id'],
        ipAddress: req.ip,
      }, 'Privileged admin mutation'));
    }
    next();
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'admin-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'postgres', check: () => pool.query('SELECT 1') },
    { name: 'kafka', check: async () => kafkaProducer.isReady() },
  ]));

  // Dashboard summary
  app.get('/api/admin/dashboard', requirePermission(Permission.READ_DASHBOARD), async (_req, res, next) => {
    try {
      const [users, orders, revenue, agents] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM auth.users WHERE role = 'user'`),
        pool.query(`SELECT COUNT(*), status FROM "order".orders GROUP BY status`),
        pool.query(`
          SELECT COALESCE(SUM(o.final_amount - COALESCE(r.refunded, 0)), 0) AS total
          FROM "order".orders o
          LEFT JOIN (SELECT order_id, SUM(amount) AS refunded FROM payment.refunds WHERE status = 'COMPLETED' GROUP BY order_id) r ON r.order_id = o.id
          WHERE o.status IN ('PAID','PROCESSING','PARTIALLY_SHIPPED','SHIPPED','COMPLETED','REFUNDED')
        `),
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
      const listFilter = buildUserListFilter(req.query as Record<string, unknown>, 3);
      const countFilter = buildUserListFilter(req.query as Record<string, unknown>);
      const [rows, count] = await Promise.all([
        pool.query(`SELECT u.id, u.email, u.role, u.first_name, u.last_name, u.is_active, u.created_at
                    FROM auth.users u ${listFilter.where}
                    ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset, ...listFilter.params]),
        pool.query(`SELECT COUNT(*) FROM auth.users u ${countFilter.where}`, countFilter.params),
      ]);
      res.json(successResponse(buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit)));
    } catch (err) { next(err); }
  });

  // Order management
  app.get('/api/admin/orders', requirePermission(Permission.READ_ALL_ORDERS), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const listFilter = buildOrderListFilter(req.query as Record<string, unknown>, 3);
      const countFilter = buildOrderListFilter(req.query as Record<string, unknown>);
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT o.*, u.email as user_email,
                  p.id AS payment_id, p.status AS payment_status,
                  p.amount AS payment_amount, p.refunded_amount
           FROM "order".orders o
           JOIN auth.users u ON o.user_id = u.id
           LEFT JOIN payment.payments p ON p.order_id = o.id
           ${listFilter.where}
           ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset, ...listFilter.params],
        ),
        pool.query(`SELECT COUNT(*) FROM "order".orders o JOIN auth.users u ON o.user_id = u.id ${countFilter.where}`, countFilter.params),
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
      const countWhere = where.replace(/\$(\d+)/g, (_match, index) => `$${Number(index) - 2}`);
      const countParams = params.slice(2);
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
          `SELECT COUNT(*) FROM product.products p ${countWhere}`,
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
                  COALESCE(SUM(oi.subtotal), 0)::int AS total_sales,
                  COALESCE(SUM(oi.subtotal * ap.commission_rate / 100), 0)::int AS commission_earned
           FROM "order".order_items oi
           JOIN "order".orders o ON o.id = oi.order_id AND o.status IN ('PAID','PROCESSING','PARTIALLY_SHIPPED','SHIPPED','COMPLETED')
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
      const agentId = String(req.params.agentId);
      const { commissionRate } = req.body;
      const rate = Number(commissionRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Commission rate must be between 0 and 100'));
      }
      const response = await fetch(`${AUTH_SERVICE_URL}/internal/agents/${encodeURIComponent(agentId)}/commission`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
        body: JSON.stringify({ commissionRate: rate, actorRole: req.user!.role }),
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.json() as { data?: { previousCommissionRate: number; commissionRate: number } };
      if (!response.ok) return res.status(response.status).json(body);
      await pool.query(
        `INSERT INTO admin.audit_logs (actor_id, actor_role, action, resource, resource_id, old_value, new_value, ip_address, user_agent)
         VALUES ($1, $2, 'agent.commission.update', 'agent', $3, $4, $5, $6, $7)`,
        [req.user!.id, req.user!.role, agentId,
         JSON.stringify({ commissionRate: body.data?.previousCommissionRate }), JSON.stringify({ commissionRate: rate }),
         req.ip, req.get('user-agent') ?? null],
      );
      res.json(successResponse({ message: 'Commission rate updated' }));
    } catch (err) { next(err); }
  });

  // Revenue + orders trend for last 30 days
  app.get('/api/admin/analytics/revenue', requirePermission(Permission.READ_REPORTS), async (_req, res, next) => {
    try {
      const rows = await pool.query(`
        SELECT
          TO_CHAR(DATE(o.created_at), 'YYYY-MM-DD') AS date,
          COALESCE(SUM(o.final_amount - COALESCE(r.refunded, 0)), 0)::int AS revenue,
          COUNT(*)::int                               AS orders
        FROM "order".orders o
        LEFT JOIN (SELECT order_id, SUM(amount) AS refunded FROM payment.refunds WHERE status = 'COMPLETED' GROUP BY order_id) r ON r.order_id = o.id
        WHERE o.created_at >= NOW() - INTERVAL '30 days'
          AND o.status IN ('PAID','PROCESSING','PARTIALLY_SHIPPED','SHIPPED','COMPLETED','REFUNDED')
        GROUP BY DATE(o.created_at)
        ORDER BY date ASC
      `);
      res.json(successResponse(rows.rows));
    } catch (err) { next(err); }
  });

  // User toggle active
  app.patch('/api/admin/users/:userId/status', requirePermission(Permission.UPDATE_ANY_USER), async (req, res, next) => {
    try {
      const userId = String(req.params.userId);
      const { isActive } = req.body;
      if (typeof isActive !== 'boolean') throw new BadRequestError('isActive must be a boolean');
      const response = await fetch(`${AUTH_SERVICE_URL}/internal/users/${encodeURIComponent(userId)}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
        body: JSON.stringify({ isActive, actorId: req.user!.id, actorRole: req.user!.role }),
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.json() as { data?: { previousIsActive: boolean; isActive: boolean } };
      if (!response.ok) return res.status(response.status).json(body);
      await pool.query(
        `INSERT INTO admin.audit_logs (actor_id, actor_role, action, resource, resource_id, old_value, new_value, ip_address, user_agent)
         VALUES ($1, $2, 'user.status.update', 'user', $3, $4, $5, $6, $7)`,
        [req.user!.id, req.user!.role, userId, JSON.stringify({ isActive: body.data?.previousIsActive }),
         JSON.stringify({ isActive }), req.ip, req.get('user-agent') ?? null],
      );
      res.json(successResponse({ message: 'User status updated' }));
    } catch (err) { next(err); }
  });

  app.delete('/api/admin/products/:productId', requirePermission(Permission.DELETE_ANY_PRODUCT), async (req, res, next) => {
    try {
      const productId = String(req.params.productId);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
        throw new BadRequestError('productId must be a UUID');
      }
      const response = await fetch(`${PRODUCT_SERVICE_URL}/internal/products/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
        headers: { 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.json() as { data?: unknown; error?: { message?: string } };
      if (!response.ok) return res.status(response.status).json(body);
      await pool.query(
        `INSERT INTO admin.audit_logs (actor_id, actor_role, action, resource, resource_id, old_value, new_value, ip_address, user_agent)
         VALUES ($1, $2, 'product.force-delete', 'product', $3, NULL, $4, $5, $6)`,
        [req.user!.id, req.user!.role, productId, JSON.stringify({ status: 'INACTIVE' }), req.ip, req.get('user-agent') ?? null],
      );
      return res.json(successResponse({ message: 'Product deleted' }));
    } catch (error) {
      next(error);
    }
  });

  // Delivery groups overview
  app.get('/api/admin/deliveries', requirePermission(Permission.READ_ALL_DELIVERIES), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const statusFilter = (req.query as any).status as string | undefined;
      const where = statusFilter ? `WHERE dg.status = $3` : '';
      const countWhere = statusFilter ? `WHERE dg.status = $1` : '';
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
        pool.query(`SELECT COUNT(*) FROM delivery.delivery_groups dg ${countWhere}`, statusFilter ? [statusFilter] : []),
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
               COUNT(oi.id) FILTER (WHERE o.id IS NOT NULL)::int AS order_count,
               COALESCE(SUM(oi.subtotal) FILTER (WHERE o.id IS NOT NULL), 0)::int AS total_sales
        FROM auth.agent_profiles ap
        LEFT JOIN "order".order_items oi ON oi.agent_id = ap.id
        LEFT JOIN "order".orders o       ON o.id = oi.order_id AND o.status IN ('PAID','PROCESSING','PARTIALLY_SHIPPED','SHIPPED','COMPLETED')
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
        SELECT i.product_id, p.name AS product_name, p.sku,
               (i.quantity_available - i.quantity_reserved) AS available,
               i.quantity_reserved, i.low_stock_threshold
        FROM inventory.inventories i
        JOIN product.products p ON p.id = i.product_id
        WHERE (i.quantity_available - i.quantity_reserved) <= i.low_stock_threshold
        ORDER BY available ASC
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
                  ps.commission_amount, ps.net_amount, ps.status, ps.created_at,
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

  app.patch('/api/admin/settlements/:settlementId/status', requirePermission(Permission.MANAGE_SETTLEMENTS), async (req, res, next) => {
    try {
      const settlementId = String(req.params.settlementId);
      const status = String(req.body?.status ?? '');
      const response = await fetch(`${PAYMENT_SERVICE_URL}/internal/settlements/${encodeURIComponent(settlementId)}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
        body: JSON.stringify({ status }), signal: AbortSignal.timeout(5000),
      });
      const body = await response.json() as { data?: { settlement: unknown; previousStatus: string; status: string } };
      if (!response.ok) return res.status(response.status).json(body);
      if (body.data?.previousStatus !== status) {
        await pool.query(
          `INSERT INTO admin.audit_logs (actor_id, actor_role, action, resource, resource_id, old_value, new_value, ip_address, user_agent)
           VALUES ($1, $2, 'settlement.status.update', 'settlement', $3, $4, $5, $6, $7)`,
          [req.user!.id, req.user!.role, settlementId,
           JSON.stringify({ status: body.data?.previousStatus }), JSON.stringify({ status }), req.ip, req.get('user-agent') ?? null],
        );
      }
      return res.json(successResponse(body.data?.settlement));
    } catch (err) { next(err); }
  });

  app.get('/api/admin/settlement-adjustments', requirePermission(Permission.READ_SETTLEMENTS), async (req, res, next) => {
    try {
      const { page, limit, offset } = buildPagination(req.query as any);
      const [rows, count] = await Promise.all([
        pool.query(
          `SELECT sa.*, ap.business_name AS agent_name, r.reference_id, r.reason
           FROM payment.settlement_adjustments sa
           JOIN auth.agent_profiles ap ON ap.id = sa.agent_id
           JOIN payment.refunds r ON r.id = sa.refund_id
           ORDER BY sa.created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        pool.query(`SELECT COUNT(*) FROM payment.settlement_adjustments`),
      ]);
      res.json(successResponse(buildPaginatedResult(rows.rows, parseInt(count.rows[0].count, 10), page, limit)));
    } catch (err) { next(err); }
  });

  app.patch('/api/admin/settlement-adjustments/:adjustmentId/status', requirePermission(Permission.MANAGE_SETTLEMENTS), async (req, res, next) => {
    try {
      const adjustmentId = String(req.params.adjustmentId);
      const status = String(req.body?.status ?? '');
      const response = await fetch(`${PAYMENT_SERVICE_URL}/internal/settlement-adjustments/${encodeURIComponent(adjustmentId)}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
        body: JSON.stringify({ status }), signal: AbortSignal.timeout(5000),
      });
      const body = await response.json() as { data?: { adjustment: unknown; previousStatus: string; status: string } };
      if (!response.ok) return res.status(response.status).json(body);
      if (body.data?.previousStatus !== status) {
        await pool.query(
          `INSERT INTO admin.audit_logs (actor_id, actor_role, action, resource, resource_id, old_value, new_value, ip_address, user_agent)
           VALUES ($1, $2, 'settlement-adjustment.status.update', 'settlement-adjustment', $3, $4, $5, $6, $7)`,
          [req.user!.id, req.user!.role, adjustmentId,
           JSON.stringify({ status: body.data?.previousStatus }), JSON.stringify({ status }), req.ip, req.get('user-agent') ?? null],
        );
      }
      res.json(successResponse(body.data?.adjustment));
    } catch (err) { next(err); }
  });

  // Force order status change (admin only)
  app.patch('/api/admin/orders/:orderId/status', requirePermission(Permission.UPDATE_ANY_ORDER_STATUS), async (req, res, next) => {
    try {
      const { status } = req.body;
      const VALID = ['PENDING','PAYMENT_PENDING','PAID','PROCESSING','PARTIALLY_SHIPPED','SHIPPED','COMPLETED','CANCELLED','REFUNDED'];
      if (!VALID.includes(status)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: `status must be one of: ${VALID.join(', ')}` } });
      }
      const orderId = String(req.params.orderId);
      const response = await fetch(`${ORDER_SERVICE_URL}/internal/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
        body: JSON.stringify({ status, changedBy: req.user!.id }),
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.json() as { data?: { previousStatus: string; status: string }; error?: { message?: string } };
      if (!response.ok) return res.status(response.status).json(body);
      await pool.query(
        `INSERT INTO admin.audit_logs (actor_id, actor_role, action, resource, resource_id, old_value, new_value, ip_address, user_agent)
         VALUES ($1, $2, 'order.status.update', 'order', $3, $4, $5, $6, $7)`,
        [req.user!.id, req.user!.role, orderId, JSON.stringify({ status: body.data?.previousStatus }),
         JSON.stringify({ status }), req.ip, req.get('user-agent') ?? null],
      );
      res.json(successResponse({ id: orderId, status }));
    } catch (err) { next(err); }
  });

  // Refund a payment through the owning service while retaining an administrator audit trail.
  app.post('/api/admin/payments/:paymentId/refund', requirePermission(Permission.ISSUE_REFUND), async (req, res, next) => {
    try {
      const paymentId = String(req.params.paymentId);
      const input = parseAdminRefundInput(paymentId, req.body);
      const response = await fetch(`${PAYMENT_SERVICE_URL}/api/payments/${encodeURIComponent(paymentId)}/refund`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': req.user!.id,
          'x-user-role': req.user!.role,
          ...(req.user!.agentId ? { 'x-agent-id': req.user!.agentId } : {}),
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json() as { data?: unknown; error?: { message?: string } };
      if (!response.ok) return res.status(response.status).json(body);

      await pool.query(
        `INSERT INTO admin.audit_logs (actor_id, actor_role, action, resource, resource_id, new_value, ip_address, user_agent)
         VALUES ($1, $2, 'payment.refund.issue', 'payment', $3, $4, $5, $6)`,
        [req.user!.id, req.user!.role, paymentId,
         JSON.stringify({ refundAmount: input.refundAmount, reason: input.reason, idempotencyKey: input.idempotencyKey }),
         req.ip, req.get('user-agent') ?? null],
      );
      return res.json(body);
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
    if (healthTimer) clearInterval(healthTimer);
    server.close(async () => {
      auditLogger.flush();
      await kafkaProducer.disconnect();
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => { console.error('Failed to start admin-service:', err); process.exit(1); });

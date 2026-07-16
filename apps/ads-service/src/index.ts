import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { z } from 'zod';
import { createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { requireApprovedAgent, requirePermission, Permission } from '@ecommerce/rbac';
import { ForbiddenError, NotFoundError, ValidationError, toHttpError } from '@ecommerce/errors';
import { buildPagination, buildPaginatedResult, errorResponse, successResponse } from '@ecommerce/shared';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { CampaignRepository } from './domain/repositories/campaign.repository';
import { CampaignUseCases } from './application/campaign.use-cases';
import { CampaignStatus } from './domain/entities/campaign.entity';

const logger = createLogger({ service: 'ads-service', level: config.logLevel });

const STATUSES: CampaignStatus[] = ['PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED'];
const StatusQuerySchema = z.enum(STATUSES as [CampaignStatus, ...CampaignStatus[]]).optional();

const CreateCampaignSchema = z.object({
  productId: z.string().uuid(),
  costPerClick: z.number().int().positive(),
  dailyBudget: z.number().int().positive(),
  totalBudget: z.number().int().positive(),
}).refine((body) => body.totalBudget >= body.dailyBudget, {
  message: 'totalBudget must be greater than or equal to dailyBudget',
  path: ['totalBudget'],
});

const RejectCampaignSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

function parseStatusQuery(value: unknown): CampaignStatus | undefined {
  if (value === undefined) return undefined;
  const parsed = StatusQuerySchema.safeParse(value);
  if (!parsed.success) throw new ValidationError('Invalid status filter', parsed.error.errors);
  return parsed.data;
}

async function bootstrap(): Promise<void> {
  const observability = createHttpObservability('ads-service', logger);
  const repo = new CampaignRepository();
  const useCases = new CampaignUseCases(repo);

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(observability.middleware);

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const agentId = req.headers['x-agent-id'];
    if (userId && userRole) req.user = { id: userId, role: userRole, agentId };
    next();
  };

  const requireInternalToken = (req: any, res: any, next: any) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ads-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([{ name: 'postgres', check: () => pool.query('SELECT 1') }]));

  // Agent: create a sponsored-placement campaign for one of their own products.
  app.post('/api/ads/campaigns', extractUser, requireApprovedAgent, async (req: any, res, next) => {
    try {
      const parsed = CreateCampaignSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid campaign request', parsed.error.errors));
      const campaign = await useCases.createCampaign(req.user.agentId, parsed.data);
      res.status(201).json(successResponse(campaign));
    } catch (err) { next(err); }
  });

  // Agent: list their own campaigns, optionally filtered by status.
  app.get('/api/ads/campaigns/my', extractUser, requireApprovedAgent, async (req: any, res, next) => {
    try {
      const status = parseStatusQuery(req.query.status);
      const { page, limit, offset } = buildPagination(req.query);
      const { rows, total } = await repo.findByAgent(req.user.agentId, status, limit, offset);
      res.json(successResponse(buildPaginatedResult(rows, total, page, limit)));
    } catch (err) { next(err); }
  });

  // Admin: list every campaign platform-wide, optionally filtered by status.
  app.get('/api/ads/campaigns', extractUser, requirePermission(Permission.READ_ALL_AD_CAMPAIGNS), async (req, res, next) => {
    try {
      const status = parseStatusQuery(req.query.status);
      const { page, limit, offset } = buildPagination(req.query);
      const { rows, total } = await repo.findAll(status, limit, offset);
      res.json(successResponse(buildPaginatedResult(rows, total, page, limit)));
    } catch (err) { next(err); }
  });

  app.get('/api/ads/campaigns/:id', extractUser, async (req: any, res, next) => {
    try {
      const campaign = await repo.findById(req.params.id);
      if (!campaign) throw new NotFoundError('Campaign', req.params.id);
      const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super-admin';
      if (!isAdmin && campaign.agentId !== req.user?.agentId) throw new ForbiddenError('You do not own this campaign');
      res.json(successResponse(campaign));
    } catch (err) { next(err); }
  });

  // Admin moderation: approve/reject a pending campaign (mirrors product/agent approval).
  app.patch('/api/ads/campaigns/:id/approve', extractUser, requirePermission(Permission.MODERATE_AD_CAMPAIGN), async (req: any, res, next) => {
    try {
      const campaign = await repo.approve(req.params.id, req.user.id);
      if (!campaign) throw new NotFoundError('Campaign', req.params.id);
      res.json(successResponse(campaign));
    } catch (err) { next(err); }
  });

  app.patch('/api/ads/campaigns/:id/reject', extractUser, requirePermission(Permission.MODERATE_AD_CAMPAIGN), async (req: any, res, next) => {
    try {
      const parsed = RejectCampaignSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Rejection reason is required', parsed.error.errors));
      const campaign = await repo.reject(req.params.id, parsed.data.reason);
      if (!campaign) throw new NotFoundError('Campaign', req.params.id);
      res.json(successResponse(campaign));
    } catch (err) { next(err); }
  });

  // Agent self-service: pause/resume their own campaign.
  app.patch('/api/ads/campaigns/:id/pause', extractUser, requireApprovedAgent, async (req: any, res, next) => {
    try {
      const existing = await repo.findById(req.params.id);
      if (!existing) throw new NotFoundError('Campaign', req.params.id);
      if (existing.agentId !== req.user.agentId) throw new ForbiddenError('You do not own this campaign');
      const campaign = await repo.pause(req.params.id);
      if (!campaign) throw new NotFoundError('Campaign', req.params.id);
      res.json(successResponse(campaign));
    } catch (err) { next(err); }
  });

  app.patch('/api/ads/campaigns/:id/resume', extractUser, requireApprovedAgent, async (req: any, res, next) => {
    try {
      const existing = await repo.findById(req.params.id);
      if (!existing) throw new NotFoundError('Campaign', req.params.id);
      if (existing.agentId !== req.user.agentId) throw new ForbiddenError('You do not own this campaign');
      const campaign = await repo.resume(req.params.id);
      if (!campaign) throw new NotFoundError('Campaign', req.params.id);
      res.json(successResponse(campaign));
    } catch (err) { next(err); }
  });

  // Any authenticated (shopper) client reports a click on a sponsored product card.
  app.post('/api/ads/campaigns/:id/click', extractUser, async (req: any, res, next) => {
    try {
      if (!req.user) return res.status(401).json(errorResponse('UNAUTHORIZED', 'Authentication required'));
      const { charged } = await useCases.recordClick(req.params.id);
      res.json(successResponse({ charged }));
    } catch (err) { next(err); }
  });

  // Internal (service-to-service): search-service asks which of these products are
  // currently sponsored, then reports impressions for whichever it actually renders.
  app.get('/internal/ads/active-by-products', requireInternalToken, async (req, res, next) => {
    try {
      const raw = typeof req.query.productIds === 'string' ? req.query.productIds : '';
      const productIds = raw.split(',').map((id) => id.trim()).filter(Boolean);
      const offers = await repo.findActiveByProductIds(productIds);
      res.json(successResponse(offers));
    } catch (err) { next(err); }
  });

  app.post('/internal/ads/impressions', requireInternalToken, async (req, res, next) => {
    try {
      const campaignIds = Array.isArray(req.body?.campaignIds) ? req.body.campaignIds.filter((id: unknown) => typeof id === 'string') : [];
      await repo.incrementImpressions(campaignIds);
      res.json(successResponse({ message: 'Impressions recorded' }));
    } catch (err) { next(err); }
  });

  app.use((err: unknown, _req: any, res: any, _next: any) => {
    const { statusCode, code, message, details } = toHttpError(err);
    res.status(statusCode).json(errorResponse(code, message, details));
  });

  const server = app.listen(config.port, () => {
    logger.info(`ads-service listening on port ${config.port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => { logger.fatal({ err }, 'Uncaught exception'); process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });
}

bootstrap().catch((err) => { console.error('Failed to start ads-service:', err); process.exit(1); });

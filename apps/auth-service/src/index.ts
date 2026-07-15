import { createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaProducer } from '@ecommerce/kafka-client';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { UserRepository, AgentProfileRepository, RefreshTokenRepository } from './domain/repositories/user.repository';
import { TokenService } from './domain/services/token.service';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case';
import { CreateAdminUseCase } from './application/use-cases/create-admin.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { ChangeUserRoleUseCase } from './application/use-cases/change-user-role.use-case';
import { ManageUserStatusUseCase } from './application/use-cases/manage-user-status.use-case';
import { UpdateCommissionUseCase } from './application/use-cases/update-commission.use-case';
import { AgentApprovalUseCase } from './application/use-cases/agent-approval.use-case';
import { AuthController } from './infrastructure/http/controllers/auth.controller';
import { AgentController } from './infrastructure/http/controllers/agent.controller';
import { createApp } from './infrastructure/http/app';
import { errorResponse, successResponse, UserRole } from '@ecommerce/shared';
import { toHttpError } from '@ecommerce/errors';

const logger = createLogger({ service: 'auth-service', level: config.logLevel });

async function bootstrap(): Promise<void> {
  // Redis
  const redis = createRedisClient({ host: config.redis.host, port: config.redis.port }, logger);

  // Kafka
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  // Repositories
  const userRepo = new UserRepository();
  const agentProfileRepo = new AgentProfileRepository();
  const refreshTokenRepo = new RefreshTokenRepository();
  const tokenService = new TokenService();

  // Use cases
  const registerUseCase = new RegisterUseCase(
    userRepo, agentProfileRepo, refreshTokenRepo, tokenService, kafkaProducer,
  );
  const loginUseCase = new LoginUseCase(userRepo, agentProfileRepo, refreshTokenRepo, tokenService);
  const refreshTokenUseCase = new RefreshTokenUseCase(userRepo, agentProfileRepo, refreshTokenRepo, tokenService);
  const createAdminUseCase = new CreateAdminUseCase(userRepo, kafkaProducer);
  const logoutUseCase = new LogoutUseCase(refreshTokenRepo, tokenService);
  const changeUserRoleUseCase = new ChangeUserRoleUseCase(userRepo, refreshTokenRepo, kafkaProducer);
  const manageUserStatusUseCase = new ManageUserStatusUseCase(userRepo, refreshTokenRepo, kafkaProducer);
  const updateCommissionUseCase = new UpdateCommissionUseCase(agentProfileRepo);
  const agentApprovalUseCase = new AgentApprovalUseCase(agentProfileRepo, kafkaProducer);

  // Controllers
  const authController = new AuthController(registerUseCase, loginUseCase, refreshTokenUseCase, createAdminUseCase, logoutUseCase, userRepo);
  const agentController = new AgentController(agentApprovalUseCase, agentProfileRepo);

  // Express app
  const app = createApp(authController, agentController, userRepo, changeUserRoleUseCase, manageUserStatusUseCase, logger);
  app.get('/ready', createReadinessHandler([
    { name: 'postgres', check: () => pool.query('SELECT 1') },
    { name: 'redis', check: () => redis.ping() },
    { name: 'kafka-producer', check: async () => kafkaProducer.isReady() },
  ]));

  app.post('/internal/agents/commission-rates', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const agentIds: unknown[] = Array.isArray(req.body?.agentIds) ? req.body.agentIds : [];
    if (agentIds.length === 0 || agentIds.length > 50 || agentIds.some((id) => typeof id !== 'string')) {
      return res.status(400).json(errorResponse('VALIDATION_ERROR', 'agentIds must contain 1 to 50 IDs'));
    }
    const rates = await agentProfileRepo.findCommissionRates([...new Set(agentIds as string[])]);
    return res.json(successResponse(Object.fromEntries(rates)));
  });

  app.patch('/internal/users/:userId/status', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    try {
      const { isActive, actorId, actorRole } = req.body ?? {};
      if (typeof isActive !== 'boolean' || typeof actorId !== 'string'
        || ![UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(actorRole)) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid user status command'));
      }
      const result = await manageUserStatusUseCase.execute(String(req.params.userId), isActive, actorId, actorRole);
      return res.json(successResponse(result));
    } catch (error) {
      const mapped = toHttpError(error);
      return res.status(mapped.statusCode).json(errorResponse(mapped.code, mapped.message, mapped.details));
    }
  });

  app.patch('/internal/agents/:agentId/commission', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    try {
      const { commissionRate, actorRole } = req.body ?? {};
      if (typeof commissionRate !== 'number' || ![UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(actorRole)) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid commission command'));
      }
      const result = await updateCommissionUseCase.execute(String(req.params.agentId), commissionRate, actorRole);
      return res.json(successResponse(result));
    } catch (error) {
      const mapped = toHttpError(error);
      return res.status(mapped.statusCode).json(errorResponse(mapped.code, mapped.message, mapped.details));
    }
  });

  app.post('/internal/agents/shipping-policies', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const agentIds: unknown[] = Array.isArray(req.body?.agentIds) ? req.body.agentIds : [];
    if (agentIds.length === 0 || agentIds.length > 50 || agentIds.some((id) => typeof id !== 'string')) {
      return res.status(400).json(errorResponse('VALIDATION_ERROR', 'agentIds must contain 1 to 50 IDs'));
    }
    const uniqueIds = [...new Set(agentIds as string[])];
    const policies = await agentProfileRepo.findShippingPolicies(uniqueIds);
    if (policies.size !== uniqueIds.length) {
      return res.status(409).json(errorResponse('AGENT_UNAVAILABLE', 'Every seller must be approved and have a shipping policy'));
    }
    return res.json(successResponse(Object.fromEntries(policies)));
  });

  app.get('/internal/agents/:agentId/user-id', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const userId = await agentProfileRepo.findUserIdByAgentId(req.params.agentId);
    if (!userId) return res.status(404).json(errorResponse('NOT_FOUND', 'Agent not found'));
    return res.json(successResponse({ userId }));
  });

  app.get('/internal/users/:userId/contact', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const user = await userRepo.findById(req.params.userId);
    if (!user || !user.isActive) return res.status(404).json(errorResponse('NOT_FOUND', 'Active user not found'));
    return res.json(successResponse({
      userId: user.id,
      email: user.email,
      phone: user.phone,
      name: `${user.firstName} ${user.lastName}`.trim(),
    }));
  });

  app.post('/internal/users/by-roles', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const allowedRoles = new Set<string>([UserRole.ADMIN, UserRole.SUPER_ADMIN]);
    const roles: unknown[] = Array.isArray(req.body?.roles) ? req.body.roles : [];
    if (roles.length === 0 || roles.length > 2 || roles.some((role) => typeof role !== 'string' || !allowedRoles.has(role))) {
      return res.status(400).json(errorResponse('VALIDATION_ERROR', 'roles must contain admin or super-admin'));
    }
    const userIds = await userRepo.findActiveIdsByRoles([...new Set(roles as UserRole[])]);
    return res.json(successResponse({ userIds }));
  });

  const server = app.listen(config.port, () => {
    logger.info(`auth-service listening on port ${config.port}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down...`);
    server.close(async () => {
      await kafkaProducer.disconnect();
      await pool.end();
      redis.disconnect();
      logger.info('auth-service shut down cleanly');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start auth-service:', err);
  process.exit(1);
});

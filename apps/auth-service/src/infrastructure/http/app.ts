import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createHttpObservability, Logger } from '@ecommerce/logger';
import { createErrorHandler } from './middleware/error-handler';
import { AuthController } from './controllers/auth.controller';
import { AgentController } from './controllers/agent.controller';
import { UserRepository } from '../../domain/repositories/user.repository';
import { createAuthRouter } from './routes/auth.routes';
import { createAgentRouter } from './routes/agent.routes';
import { createUserRouter } from './routes/user.routes';
import { ChangeUserRoleUseCase } from '../../application/use-cases/change-user-role.use-case';
import { ManageUserStatusUseCase } from '../../application/use-cases/manage-user-status.use-case';

export function createApp(
  authController: AuthController,
  agentController: AgentController,
  userRepo: UserRepository,
  changeUserRole: ChangeUserRoleUseCase,
  manageUserStatus: ManageUserStatusUseCase,
  logger: Logger,
): Application {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  const observability = createHttpObservability('auth-service', logger);
  app.use(observability.middleware);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 20,
    message: 'Too many login attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'auth-service', timestamp: new Date().toISOString() });
  });
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));

  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth/register', loginLimiter);
  app.use('/api/auth/refresh', loginLimiter);
  app.use('/api/auth', createAuthRouter(authController));
  app.use('/api/agents', createAgentRouter(agentController));
  app.use('/api/users', createUserRouter(userRepo, changeUserRole, manageUserStatus));

  app.use(createErrorHandler(logger));

  return app;
}

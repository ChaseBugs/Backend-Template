import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Logger } from '@ecommerce/logger';
import { createErrorHandler } from './middleware/error-handler';
import { AuthController } from './controllers/auth.controller';
import { AgentController } from './controllers/agent.controller';
import { UserRepository } from '../../domain/repositories/user.repository';
import { createAuthRouter } from './routes/auth.routes';
import { createAgentRouter } from './routes/agent.routes';
import { createUserRouter } from './routes/user.routes';

export function createApp(
  authController: AuthController,
  agentController: AgentController,
  userRepo: UserRepository,
  logger: Logger,
): Application {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

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

  app.use('/api/auth', loginLimiter, createAuthRouter(authController));
  app.use('/api/agents', createAgentRouter(agentController));
  app.use('/api/users', createUserRouter(userRepo));

  app.use(createErrorHandler(logger));

  return app;
}

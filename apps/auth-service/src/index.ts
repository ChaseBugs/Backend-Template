import { createLogger } from '@ecommerce/logger';
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
import { AgentApprovalUseCase } from './application/use-cases/agent-approval.use-case';
import { AuthController } from './infrastructure/http/controllers/auth.controller';
import { AgentController } from './infrastructure/http/controllers/agent.controller';
import { createApp } from './infrastructure/http/app';

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
  const agentApprovalUseCase = new AgentApprovalUseCase(agentProfileRepo, kafkaProducer);

  // Controllers
  const authController = new AuthController(registerUseCase, loginUseCase, refreshTokenUseCase, createAdminUseCase);
  const agentController = new AgentController(agentApprovalUseCase, agentProfileRepo);

  // Express app
  const app = createApp(authController, agentController, userRepo, logger);

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

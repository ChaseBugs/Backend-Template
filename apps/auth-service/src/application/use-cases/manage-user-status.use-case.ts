import { PoolClient } from 'pg';
import { BadRequestError, ForbiddenError, NotFoundError } from '@ecommerce/errors';
import { KafkaTopic, UserRole } from '@ecommerce/shared';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { UserRepository, RefreshTokenRepository } from '../../domain/repositories/user.repository';
import { withTransaction } from '../../infrastructure/db/pool';

type TransactionRunner = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;

export class ManageUserStatusUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly producer: KafkaProducer,
    private readonly transaction: TransactionRunner = withTransaction,
  ) {}

  async execute(userId: string, isActive: boolean, actorId: string, actorRole: UserRole) {
    const result = await this.transaction(async (client) => {
      const user = await this.users.findByIdForUpdate(userId, client);
      if (!user) throw new NotFoundError('User', userId);
      const privileged = user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
      if (privileged && actorRole !== UserRole.SUPER_ADMIN) throw new ForbiddenError('Only super-admin can manage admin accounts');
      if (!isActive && actorId === userId) throw new BadRequestError('You cannot deactivate your own account');

      const previousIsActive = user.isActive;
      const updatedAt = previousIsActive === isActive
        ? user.updatedAt
        : await this.users.updateActiveStatus(userId, isActive, client);
      if (!isActive) await this.refreshTokens.deleteByUserId(userId, client);
      return { userId, previousIsActive, isActive, updatedAt };
    });

    await this.producer.send(KafkaTopic.USER_STATUS_CHANGED, {
      topic: KafkaTopic.USER_STATUS_CHANGED,
      payload: { userId, isActive },
    }, userId, `user-status:${userId}:${isActive}:${result.updatedAt.toISOString()}`);
    return result;
  }
}

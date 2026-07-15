import { KafkaProducer } from '@ecommerce/kafka-client';
import { ConflictError, NotFoundError } from '@ecommerce/errors';
import { KafkaTopic, UserRole } from '@ecommerce/shared';
import { RefreshTokenRepository, UserRepository } from '../../domain/repositories/user.repository';

export class ChangeUserRoleUseCase {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async execute(userId: string, role: UserRole.ADMIN | UserRole.USER, changedBy: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User', userId);
    if (user.role === UserRole.SUPER_ADMIN) throw new ConflictError('The seeded super-admin role cannot be changed');
    if (user.role === UserRole.AGENT) throw new ConflictError('Agent roles must be managed through the agent approval workflow');

    if (user.role !== role) {
      const updated = await this.userRepo.updateRole(userId, role);
      if (!updated) throw new NotFoundError('User', userId);
    }
    // Repeat on recovery so a prior DB commit followed by revocation failure cannot preserve sessions.
    await this.refreshTokenRepo.deleteByUserId(userId);

    await this.kafkaProducer.send(KafkaTopic.USER_ROLE_CHANGED, {
      topic: KafkaTopic.USER_ROLE_CHANGED,
      payload: { userId, role, changedBy },
    }, userId);
  }
}

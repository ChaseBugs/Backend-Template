import { PoolClient } from 'pg';
import { BadRequestError, ForbiddenError, NotFoundError } from '@ecommerce/errors';
import { UserRole } from '@ecommerce/shared';
import { AgentProfileRepository } from '../../domain/repositories/user.repository';
import { withTransaction } from '../../infrastructure/db/pool';

type TransactionRunner = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;

export class UpdateCommissionUseCase {
  constructor(
    private readonly agents: AgentProfileRepository,
    private readonly transaction: TransactionRunner = withTransaction,
  ) {}

  async execute(agentId: string, commissionRate: number, actorRole: UserRole) {
    if (actorRole !== UserRole.SUPER_ADMIN) throw new ForbiddenError('Only super-admin can update commission rates');
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
      throw new BadRequestError('Commission rate must be between 0 and 100');
    }
    return this.transaction(async (client) => {
      const agent = await this.agents.findByIdForUpdate(agentId, client);
      if (!agent) throw new NotFoundError('Agent', agentId);
      const previousCommissionRate = agent.commissionRate;
      if (previousCommissionRate !== commissionRate) await this.agents.setCommissionRate(agentId, commissionRate, client);
      return { agentId, previousCommissionRate, commissionRate };
    });
  }
}

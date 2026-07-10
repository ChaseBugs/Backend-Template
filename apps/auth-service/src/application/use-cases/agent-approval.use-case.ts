import { AgentProfileRepository } from '../../domain/repositories/user.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { AgentApprovalStatus, KafkaTopic } from '@ecommerce/shared';
import { NotFoundError } from '@ecommerce/errors';
import { ApproveAgentDto, RejectAgentDto } from '../dtos/auth.dto';

export class AgentApprovalUseCase {
  constructor(
    private readonly agentProfileRepo: AgentProfileRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async approve(agentId: string, approvedBy: string, dto: ApproveAgentDto): Promise<void> {
    const profile = await this.agentProfileRepo.findById(agentId);
    if (!profile) throw new NotFoundError('Agent profile', agentId);

    const updated = await this.agentProfileRepo.updateApprovalStatus(
      agentId,
      AgentApprovalStatus.APPROVED,
      approvedBy,
    );

    if (dto.commissionRate !== undefined) {
      await this.agentProfileRepo.setCommissionRate(agentId, dto.commissionRate);
    }

    await this.kafkaProducer.send(
      KafkaTopic.AGENT_APPROVED,
      {
        topic: KafkaTopic.AGENT_APPROVED,
        payload: {
          agentId: updated.id,
          userId: updated.userId,
          businessName: updated.businessName,
          approvedBy,
        },
      },
      agentId,
    );
  }

  async reject(agentId: string, rejectedBy: string, dto: RejectAgentDto): Promise<void> {
    const profile = await this.agentProfileRepo.findById(agentId);
    if (!profile) throw new NotFoundError('Agent profile', agentId);

    await this.agentProfileRepo.updateApprovalStatus(
      agentId,
      AgentApprovalStatus.REJECTED,
      rejectedBy,
      dto.reason,
    );

    await this.kafkaProducer.send(
      KafkaTopic.AGENT_REJECTED,
      {
        topic: KafkaTopic.AGENT_REJECTED,
        payload: {
          agentId,
          userId: profile.userId,
          reason: dto.reason,
        },
      },
      agentId,
    );
  }

  async getPendingAgents(page: number, limit: number): Promise<{ agents: unknown[]; total: number }> {
    const offset = (page - 1) * limit;
    return this.agentProfileRepo.findPending(limit, offset);
  }
}

import { AgentProfileRepository } from '../../domain/repositories/user.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { AgentApprovalStatus, KafkaTopic } from '@ecommerce/shared';
import { ConflictError, NotFoundError } from '@ecommerce/errors';
import { ApproveAgentDto, RejectAgentDto } from '../dtos/auth.dto';
import { withTransaction } from '../../infrastructure/db/pool';

export class AgentApprovalUseCase {
  constructor(
    private readonly agentProfileRepo: AgentProfileRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async approve(agentId: string, approvedBy: string, dto: ApproveAgentDto): Promise<void> {
    const profile = await this.agentProfileRepo.findById(agentId);
    if (!profile) throw new NotFoundError('Agent profile', agentId);
    if (profile.approvalStatus === AgentApprovalStatus.APPROVED) {
      if (dto.commissionRate !== undefined && profile.commissionRate !== dto.commissionRate) {
        throw new ConflictError('Agent was already approved with a different commission rate');
      }
      await this.publishApproved(profile, profile.approvedBy ?? approvedBy);
      return;
    }
    if (profile.approvalStatus !== AgentApprovalStatus.PENDING) {
      throw new ConflictError(`Cannot approve an agent in ${profile.approvalStatus} status`);
    }

    const updated = await withTransaction(async (client) => {
      const result = await this.agentProfileRepo.updateApprovalStatus(
        agentId, AgentApprovalStatus.APPROVED, approvedBy, undefined, client,
      );
      if (!result) throw new ConflictError('Agent approval state changed concurrently');
      if (dto.commissionRate !== undefined) {
        await this.agentProfileRepo.setCommissionRate(agentId, dto.commissionRate, client);
        result.commissionRate = dto.commissionRate;
      }
      return result;
    });

    await this.publishApproved(updated, approvedBy);
  }

  private async publishApproved(updated: { id: string; userId: string; businessName: string }, approvedBy: string): Promise<void> {
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
      updated.id,
    );
  }

  async reject(agentId: string, rejectedBy: string, dto: RejectAgentDto): Promise<void> {
    const profile = await this.agentProfileRepo.findById(agentId);
    if (!profile) throw new NotFoundError('Agent profile', agentId);
    if (profile.approvalStatus === AgentApprovalStatus.REJECTED) {
      if (profile.rejectionReason !== dto.reason) throw new ConflictError('Agent was already rejected for a different reason');
      await this.publishRejected(profile.id, profile.userId, dto.reason);
      return;
    }
    if (profile.approvalStatus !== AgentApprovalStatus.PENDING) {
      throw new ConflictError(`Cannot reject an agent in ${profile.approvalStatus} status`);
    }

    const updated = await this.agentProfileRepo.updateApprovalStatus(
      agentId,
      AgentApprovalStatus.REJECTED,
      rejectedBy,
      dto.reason,
    );
    if (!updated) throw new ConflictError('Agent rejection state changed concurrently');

    await this.publishRejected(agentId, profile.userId, dto.reason);
  }

  private async publishRejected(agentId: string, userId: string, reason: string): Promise<void> {
    await this.kafkaProducer.send(
      KafkaTopic.AGENT_REJECTED,
      {
        topic: KafkaTopic.AGENT_REJECTED,
        payload: {
          agentId,
          userId,
          reason,
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

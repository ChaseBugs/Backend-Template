import { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '@ecommerce/errors';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { KafkaTopic } from '@ecommerce/shared';
import { PaymentRepository, SettlementAdjustmentRecord } from '../domain/repositories/payment.repository';
import { AgentSettlement } from '../domain/entities/payment.entity';
import { withTransaction } from '../infrastructure/db/pool';

export type SettlementStatus = AgentSettlement['status'];
export type AdjustmentStatus = SettlementAdjustmentRecord['status'];
type TransactionRunner = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;

const settlementTransitions: Record<SettlementStatus, SettlementStatus[]> = {
  PENDING: ['PROCESSING', 'HELD', 'CANCELLED'], PROCESSING: ['COMPLETED', 'HELD', 'CANCELLED'],
  HELD: ['PROCESSING', 'CANCELLED'], COMPLETED: [], CANCELLED: [],
};
const adjustmentTransitions: Record<AdjustmentStatus, AdjustmentStatus[]> = {
  PENDING: ['PROCESSING', 'CANCELLED'], PROCESSING: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [],
};

export function isSettlementStatus(value: string): value is SettlementStatus { return value in settlementTransitions; }
export function isAdjustmentStatus(value: string): value is AdjustmentStatus { return value in adjustmentTransitions; }

export class SettlementManagementUseCase {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly producer: Pick<KafkaProducer, 'send'>,
    private readonly transaction: TransactionRunner = withTransaction,
  ) {}

  async updateSettlement(settlementId: string, status: string) {
    if (!isSettlementStatus(status) || status === 'PENDING') throw new BadRequestError('Invalid settlement status');
    const result = await this.transaction(async (client) => {
      const current = await this.repository.findSettlementForUpdate(settlementId, client);
      if (!current) throw new NotFoundError('Settlement', settlementId);
      if (current.status !== status && !settlementTransitions[current.status].includes(status)) {
        throw new BadRequestError(`Cannot change settlement from ${current.status} to ${status}`);
      }
      const settlement = current.status === status ? current : await this.repository.updateSettlementStatus(settlementId, status, client);
      return { settlement, previousStatus: current.status };
    });
    if (status === 'COMPLETED') await this.publishCompleted(result.settlement);
    return { ...result, status };
  }

  async updateAdjustment(adjustmentId: string, status: string) {
    if (!isAdjustmentStatus(status) || status === 'PENDING') throw new BadRequestError('Invalid settlement adjustment status');
    return this.transaction(async (client) => {
      const current = await this.repository.findSettlementAdjustmentForUpdate(adjustmentId, client);
      if (!current) throw new NotFoundError('Settlement adjustment', adjustmentId);
      if (current.status !== status && !adjustmentTransitions[current.status].includes(status)) {
        throw new BadRequestError(`Cannot change adjustment from ${current.status} to ${status}`);
      }
      const adjustment = current.status === status ? current : await this.repository.updateSettlementAdjustmentStatus(adjustmentId, status, client);
      return { adjustment, previousStatus: current.status, status };
    });
  }

  private async publishCompleted(settlement: AgentSettlement): Promise<void> {
    if (!settlement.settledAt) throw new BadRequestError('Completed settlement has no completion time');
    await this.producer.send(KafkaTopic.AGENT_SETTLEMENT_COMPLETED, {
      topic: KafkaTopic.AGENT_SETTLEMENT_COMPLETED,
      payload: {
        settlementId: settlement.id, paymentId: settlement.paymentId, orderId: settlement.orderId,
        agentId: settlement.agentId, netAmount: settlement.netAmount, completedAt: settlement.settledAt.toISOString(),
      },
    }, settlement.id, settlement.id);
  }
}

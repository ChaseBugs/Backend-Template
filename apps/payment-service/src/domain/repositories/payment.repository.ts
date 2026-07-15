import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pool';
import { Payment, AgentSettlement, PaymentMethod } from '../entities/payment.entity';
import { PaymentStatus } from '@ecommerce/shared';

export interface RefundRecord {
  id: string;
  paymentId: string;
  orderId: string;
  referenceId: string;
  agentId?: string;
  amount: number;
  reason: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  gatewayRefundId?: string;
  failureReason?: string;
}

export interface SettlementAdjustmentInput {
  id: string;
  settlementId: string;
  refundId: string;
  agentId: string;
  orderId: string;
  grossAmount: number;
  commissionReversal: number;
  netAmount: number;
}

export interface SettlementAdjustmentRecord extends SettlementAdjustmentInput {
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  processedAt?: Date;
  createdAt: Date;
}

export class PaymentRepository {
  async findByIdForUpdate(id: string, client: PoolClient): Promise<Payment | null> {
    const result = await client.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [id]);
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async findByIdempotencyKey(key: string, client?: PoolClient): Promise<Payment | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM payments WHERE idempotency_key = $1`, [key]);
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async findById(id: string, client?: PoolClient): Promise<Payment | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM payments WHERE id = $1`, [id]);
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async findByOrderId(orderId: string, client?: PoolClient): Promise<Payment | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM payments WHERE order_id = $1`, [orderId]);
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async create(payment: Omit<Payment, 'createdAt' | 'updatedAt'>, client?: PoolClient): Promise<Payment> {
    const db = client ?? pool;
    const result = await db.query(
      `INSERT INTO payments
         (id, order_id, saga_id, user_id, amount, method, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [payment.id, payment.orderId, payment.sagaId, payment.userId,
       payment.amount, payment.method, payment.status, payment.idempotencyKey],
    );
    return this.map(result.rows[0]);
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    extra?: { transactionId?: string; failureReason?: string; refundAmount?: number },
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE payments SET
         status = $2,
         transaction_id = COALESCE($3, transaction_id),
         failure_reason = COALESCE($4, failure_reason),
         refund_amount = COALESCE($5, refund_amount),
         paid_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE paid_at END,
         refunded_at = CASE WHEN $2 IN ('REFUNDED','PARTIALLY_REFUNDED') THEN NOW() ELSE refunded_at END,
         updated_at = NOW()
       WHERE id = $1`,
      [id, status, extra?.transactionId ?? null, extra?.failureReason ?? null, extra?.refundAmount ?? null],
    );
  }

  async createSettlement(settlement: Omit<AgentSettlement, 'createdAt'>, client?: PoolClient): Promise<AgentSettlement> {
    const db = client ?? pool;
    const result = await db.query(
      `INSERT INTO agent_settlements
         (id, payment_id, order_id, agent_id, gross_amount, commission_rate, commission_amount, net_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (order_id, agent_id) DO UPDATE
         SET payment_id = agent_settlements.payment_id
       RETURNING *`,
      [settlement.id, settlement.paymentId, settlement.orderId, settlement.agentId,
       settlement.grossAmount, settlement.commissionRate, settlement.commissionAmount,
       settlement.netAmount, settlement.status],
    );
    return this.mapSettlement(result.rows[0]);
  }

  async findSettlementsByAgent(agentId: string, limit: number, offset: number, client?: PoolClient) {
    const db = client ?? pool;
    const [rows, count] = await Promise.all([
      db.query(
        `SELECT s.*, p.order_id FROM agent_settlements s
         JOIN payments p ON s.payment_id = p.id
         WHERE s.agent_id = $1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3`,
        [agentId, limit, offset],
      ),
      db.query(`SELECT COUNT(*) FROM agent_settlements WHERE agent_id = $1`, [agentId]),
    ]);
    return { items: rows.rows, total: parseInt(count.rows[0].count, 10) };
  }

  async getAgentPayoutSummary(agentId: string, client?: PoolClient): Promise<Array<{
    status: string; count: number; netAmount: number; grossAmount: number; commissionAmount: number;
  }>> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT status,
              COUNT(*)::int                       AS count,
              COALESCE(SUM(net_amount), 0)::int    AS net_amount,
              COALESCE(SUM(gross_amount), 0)::int  AS gross_amount,
              COALESCE(SUM(commission_amount), 0)::int AS commission_amount
       FROM agent_settlements
       WHERE agent_id = $1
       GROUP BY status`,
      [agentId],
    );
    return result.rows.map((row) => ({
      status: row.status as string,
      count: Number(row.count),
      netAmount: Number(row.net_amount),
      grossAmount: Number(row.gross_amount),
      commissionAmount: Number(row.commission_amount),
    }));
  }

  private map(row: Record<string, unknown>): Payment {
    return {
      id: row.id as string,
      orderId: row.order_id as string,
      sagaId: row.saga_id as string,
      userId: row.user_id as string,
      amount: parseFloat(row.amount as string),
      method: row.method as PaymentMethod,
      status: row.status as PaymentStatus,
      transactionId: row.transaction_id as string | undefined,
      idempotencyKey: row.idempotency_key as string,
      failureReason: row.failure_reason as string | undefined,
      refundAmount: row.refund_amount ? parseFloat(row.refund_amount as string) : undefined,
      paidAt: row.paid_at ? new Date(row.paid_at as string) : undefined,
      refundedAt: row.refunded_at ? new Date(row.refunded_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  async findSettlementsByPayment(paymentId: string, client?: PoolClient): Promise<AgentSettlement[]> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM agent_settlements WHERE payment_id = $1 ORDER BY id`, [paymentId]);
    return result.rows.map((row) => this.mapSettlement(row));
  }

  async findSettlementForUpdate(id: string, client: PoolClient): Promise<AgentSettlement | null> {
    const result = await client.query(`SELECT * FROM agent_settlements WHERE id = $1 FOR UPDATE`, [id]);
    return result.rows[0] ? this.mapSettlement(result.rows[0]) : null;
  }

  async updateSettlementStatus(id: string, status: AgentSettlement['status'], client: PoolClient): Promise<AgentSettlement> {
    const result = await client.query(
      `UPDATE agent_settlements SET status = $2,
         settled_at = CASE WHEN $2 = 'COMPLETED' THEN COALESCE(settled_at, NOW()) ELSE settled_at END
       WHERE id = $1 RETURNING *`,
      [id, status],
    );
    return this.mapSettlement(result.rows[0]);
  }

  async finalizePending(
    id: string,
    status: PaymentStatus.COMPLETED | PaymentStatus.FAILED,
    extra: { transactionId?: string; failureReason?: string },
    client?: PoolClient,
  ): Promise<Payment | null> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE payments SET
         status = $2,
         transaction_id = COALESCE($3, transaction_id),
         failure_reason = COALESCE($4, failure_reason),
         paid_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE paid_at END,
         updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING *`,
      [id, status, extra.transactionId ?? null, extra.failureReason ?? null],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async cancelSettlementsByPayment(paymentId: string, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE agent_settlements SET status = 'CANCELLED'
       WHERE payment_id = $1 AND status <> 'CANCELLED'`,
      [paymentId],
    );
  }

  async findRefundByReference(referenceId: string, client?: PoolClient): Promise<RefundRecord | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM refunds WHERE reference_id = $1`, [referenceId]);
    const row = result.rows[0];
    return row ? this.mapRefund(row) : null;
  }

  async sumRefunds(paymentId: string, client?: PoolClient): Promise<number> {
    const db = client ?? pool;
    const result = await db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM refunds WHERE payment_id = $1 AND status = 'COMPLETED'`, [paymentId]);
    return Number(result.rows[0].total);
  }

  async sumReservedRefunds(paymentId: string, client?: PoolClient): Promise<number> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM refunds WHERE payment_id = $1 AND status IN ('PENDING','COMPLETED')`,
      [paymentId],
    );
    return Number(result.rows[0].total);
  }

  async createRefund(input: { id: string; paymentId: string; orderId: string; referenceId: string; agentId?: string; amount: number; reason: string }, client?: PoolClient): Promise<RefundRecord> {
    const db = client ?? pool;
    const result = await db.query(
      `INSERT INTO refunds (id, payment_id, order_id, reference_id, agent_id, amount, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING') RETURNING *`,
      [input.id, input.paymentId, input.orderId, input.referenceId, input.agentId ?? null, input.amount, input.reason],
    );
    return this.mapRefund(result.rows[0]);
  }

  async finalizePendingRefund(id: string, status: 'COMPLETED' | 'FAILED', extra: { gatewayRefundId?: string; failureReason?: string }, client?: PoolClient): Promise<RefundRecord | null> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE refunds SET status = $2, gateway_refund_id = COALESCE($3, gateway_refund_id),
         failure_reason = COALESCE($4, failure_reason),
         completed_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE completed_at END
       WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [id, status, extra.gatewayRefundId ?? null, extra.failureReason ?? null],
    );
    return result.rows[0] ? this.mapRefund(result.rows[0]) : null;
  }

  async createSettlementAdjustment(input: SettlementAdjustmentInput, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `INSERT INTO settlement_adjustments
         (id, settlement_id, refund_id, agent_id, order_id, gross_amount, commission_reversal, net_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (settlement_id, refund_id) DO NOTHING`,
      [input.id, input.settlementId, input.refundId, input.agentId, input.orderId,
       input.grossAmount, input.commissionReversal, input.netAmount],
    );
  }

  async findSettlementAdjustmentForUpdate(id: string, client: PoolClient): Promise<SettlementAdjustmentRecord | null> {
    const result = await client.query(`SELECT * FROM settlement_adjustments WHERE id = $1 FOR UPDATE`, [id]);
    return result.rows[0] ? this.mapSettlementAdjustment(result.rows[0]) : null;
  }

  async updateSettlementAdjustmentStatus(id: string, status: SettlementAdjustmentRecord['status'], client: PoolClient): Promise<SettlementAdjustmentRecord> {
    const result = await client.query(
      `UPDATE settlement_adjustments SET status = $2,
         processed_at = CASE WHEN $2 = 'COMPLETED' THEN COALESCE(processed_at, NOW()) ELSE processed_at END
       WHERE id = $1 RETURNING *`,
      [id, status],
    );
    return this.mapSettlementAdjustment(result.rows[0]);
  }

  async cancelSettlementByPaymentAndAgent(paymentId: string, agentId: string, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE agent_settlements SET status = 'CANCELLED'
       WHERE payment_id = $1 AND agent_id = $2 AND status NOT IN ('COMPLETED','CANCELLED')`,
      [paymentId, agentId],
    );
  }

  private mapSettlement(row: Record<string, unknown>): AgentSettlement {
    return {
      id: row.id as string,
      paymentId: row.payment_id as string,
      orderId: row.order_id as string,
      agentId: row.agent_id as string,
      grossAmount: parseFloat(row.gross_amount as string),
      commissionRate: parseFloat(row.commission_rate as string),
      commissionAmount: parseFloat(row.commission_amount as string),
      netAmount: parseFloat(row.net_amount as string),
      status: row.status as AgentSettlement['status'],
      settledAt: row.settled_at ? new Date(row.settled_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    };
  }

  private mapSettlementAdjustment(row: Record<string, unknown>): SettlementAdjustmentRecord {
    return {
      id: row.id as string, settlementId: row.settlement_id as string, refundId: row.refund_id as string,
      agentId: row.agent_id as string, orderId: row.order_id as string, grossAmount: Number(row.gross_amount),
      commissionReversal: Number(row.commission_reversal), netAmount: Number(row.net_amount),
      status: row.status as SettlementAdjustmentRecord['status'],
      processedAt: row.processed_at ? new Date(row.processed_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    };
  }

  private mapRefund(row: Record<string, unknown>): RefundRecord {
    return {
      id: row.id as string,
      paymentId: row.payment_id as string,
      orderId: row.order_id as string,
      referenceId: row.reference_id as string,
      agentId: row.agent_id as string | undefined,
      amount: Number(row.amount),
      reason: row.reason as string,
      status: row.status as RefundRecord['status'],
      gatewayRefundId: row.gateway_refund_id as string | undefined,
      failureReason: row.failure_reason as string | undefined,
    };
  }
}

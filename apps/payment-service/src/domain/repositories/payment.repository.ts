import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pool';
import { Payment, AgentSettlement, PaymentMethod } from '../entities/payment.entity';
import { PaymentStatus } from '@ecommerce/shared';

export class PaymentRepository {
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

  async createSettlement(settlement: Omit<AgentSettlement, 'createdAt'>, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `INSERT INTO agent_settlements
         (id, payment_id, agent_id, gross_amount, commission_rate, commission_amount, net_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [settlement.id, settlement.paymentId, settlement.agentId, settlement.grossAmount,
       settlement.commissionRate, settlement.commissionAmount, settlement.netAmount],
    );
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
}

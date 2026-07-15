import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pool';
import { DeliveryGroup, DeliveryGroupItem, ReturnRequest } from '../entities/delivery.entity';
import { DeliveryGroupStatus } from '@ecommerce/shared';

export class DeliveryRepository {
  async findOverduePreparing(cutoff: Date, limit: number, client?: PoolClient): Promise<DeliveryGroup[]> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT * FROM delivery_groups
       WHERE status = $1 AND created_at <= $2 AND delay_alerted_at IS NULL
       ORDER BY created_at ASC
       LIMIT $3`,
      [DeliveryGroupStatus.PREPARING, cutoff, limit],
    );
    return result.rows.map(this.mapGroup);
  }

  async markDelayAlerted(id: string, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE delivery_groups SET delay_alerted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND delay_alerted_at IS NULL`,
      [id],
    );
  }

  async createGroup(group: Omit<DeliveryGroup, 'createdAt' | 'updatedAt'>, items: Omit<DeliveryGroupItem, 'id'>[], client?: PoolClient): Promise<{ group: DeliveryGroup; created: boolean }> {
    const db = client ?? pool;

    const result = await db.query(
      `INSERT INTO delivery_groups (id, order_id, user_id, payment_id, agent_id, status, shipping_fee)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (order_id, agent_id) DO NOTHING RETURNING *`,
      [group.id, group.orderId, group.userId, group.paymentId, group.agentId, group.status, group.shippingFee],
    );

    const created = Boolean(result.rows[0]);
    const row = result.rows[0] ?? (await db.query(
      `SELECT * FROM delivery_groups WHERE order_id = $1 AND agent_id = $2`,
      [group.orderId, group.agentId],
    )).rows[0];

    if (created) for (const item of items) {
      await db.query(
        `INSERT INTO delivery_group_items (id, delivery_group_id, product_id, quantity)
         VALUES (gen_random_uuid(), $1, $2, $3)`,
        [group.id, item.productId, item.quantity],
      );
    }

    return { group: this.mapGroup(row), created };
  }

  async findById(id: string, client?: PoolClient): Promise<DeliveryGroup | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM delivery_groups WHERE id = $1`, [id]);
    return result.rows[0] ? this.mapGroup(result.rows[0]) : null;
  }

  async findByOrderId(orderId: string, client?: PoolClient): Promise<DeliveryGroup[]> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM delivery_groups WHERE order_id = $1`, [orderId]);
    return result.rows.map(this.mapGroup);
  }

  async findByAgent(agentId: string, limit: number, offset: number, status?: DeliveryGroupStatus, client?: PoolClient): Promise<{ groups: DeliveryGroup[]; total: number }> {
    const db = client ?? pool;
    const statusClause = status ? ' AND status = $4' : '';
    const values = status ? [agentId, limit, offset, status] : [agentId, limit, offset];
    const [rows, count] = await Promise.all([
      db.query(`SELECT * FROM delivery_groups WHERE agent_id = $1${statusClause} ORDER BY created_at DESC LIMIT $2 OFFSET $3`, values),
      db.query(`SELECT COUNT(*) FROM delivery_groups WHERE agent_id = $1${status ? ' AND status = $2' : ''}`, status ? [agentId, status] : [agentId]),
    ]);
    return { groups: rows.rows.map(this.mapGroup), total: parseInt(count.rows[0].count, 10) };
  }

  async getAgentStatusCounts(agentId: string, client?: PoolClient): Promise<Array<{ status: string; count: number }>> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT status, COUNT(*)::int AS count FROM delivery_groups WHERE agent_id = $1 GROUP BY status`,
      [agentId],
    );
    return result.rows.map((row) => ({ status: row.status as string, count: Number(row.count) }));
  }

  async updateStatus(id: string, status: DeliveryGroupStatus, extra?: {
    courierName?: string; trackingNumber?: string; shippedAt?: Date; deliveredAt?: Date; returnedAt?: Date;
  }, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE delivery_groups SET
         status = $2,
         courier_name = COALESCE($3, courier_name),
         tracking_number = COALESCE($4, tracking_number),
         shipped_at = COALESCE($5, shipped_at),
         delivered_at = COALESCE($6, delivered_at),
         returned_at = COALESCE($7, returned_at),
         updated_at = NOW()
       WHERE id = $1`,
      [id, status, extra?.courierName ?? null, extra?.trackingNumber ?? null,
       extra?.shippedAt ?? null, extra?.deliveredAt ?? null, extra?.returnedAt ?? null],
    );
  }

  async countByOrderAndStatus(orderId: string, status: DeliveryGroupStatus, client?: PoolClient): Promise<number> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT COUNT(*) FROM delivery_groups WHERE order_id = $1 AND status = $2`,
      [orderId, status],
    );
    return parseInt(result.rows[0].count, 10);
  }

  async countByOrder(orderId: string, client?: PoolClient): Promise<number> {
    const db = client ?? pool;
    const result = await db.query(`SELECT COUNT(*) FROM delivery_groups WHERE order_id = $1`, [orderId]);
    return parseInt(result.rows[0].count, 10);
  }

  async createReturnRequest(req: Omit<ReturnRequest, 'createdAt' | 'updatedAt'>, client?: PoolClient): Promise<ReturnRequest> {
    const db = client ?? pool;
    const result = await db.query(
      `INSERT INTO return_requests (id, delivery_group_id, order_id, user_id, reason, status, refund_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.id, req.deliveryGroupId, req.orderId, req.userId, req.reason, req.status, req.refundAmount ?? null],
    );
    return this.mapReturnRequest(result.rows[0]);
  }

  async updateReturnStatus(id: string, status: ReturnRequest['status'], refundAmount?: number, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE return_requests SET status = $2, refund_amount = COALESCE($3, refund_amount), updated_at = NOW() WHERE id = $1`,
      [id, status, refundAmount ?? null],
    );
  }

  async findReturnByDeliveryGroup(deliveryGroupId: string, client?: PoolClient): Promise<ReturnRequest | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM return_requests WHERE delivery_group_id = $1`, [deliveryGroupId]);
    return result.rows[0] ? this.mapReturnRequest(result.rows[0]) : null;
  }

  async countFulfillmentStarted(orderId: string, client?: PoolClient): Promise<number> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT COUNT(*) FROM delivery_groups
       WHERE order_id = $1 AND status IN ($2, $3, $4, $5, $6)`,
      [orderId, DeliveryGroupStatus.SHIPPED, DeliveryGroupStatus.IN_TRANSIT, DeliveryGroupStatus.DELIVERED,
       DeliveryGroupStatus.RETURN_REQUESTED, DeliveryGroupStatus.RETURNED],
    );
    return parseInt(result.rows[0].count, 10);
  }

  async cancelPreparingByOrder(orderId: string, client?: PoolClient): Promise<number> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE delivery_groups SET status = $2, updated_at = NOW()
       WHERE order_id = $1 AND status = $3`,
      [orderId, DeliveryGroupStatus.CANCELLED, DeliveryGroupStatus.PREPARING],
    );
    return result.rowCount ?? 0;
  }

  async findReturnById(id: string, client?: PoolClient): Promise<ReturnRequest | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM return_requests WHERE id = $1`, [id]);
    return result.rows[0] ? this.mapReturnRequest(result.rows[0]) : null;
  }

  private mapGroup(row: Record<string, unknown>): DeliveryGroup {
    return {
      id: row.id as string,
      orderId: row.order_id as string,
      userId: row.user_id as string,
      paymentId: row.payment_id as string,
      agentId: row.agent_id as string,
      status: row.status as DeliveryGroupStatus,
      shippingFee: parseFloat(row.shipping_fee as string),
      courierName: row.courier_name as string | undefined,
      trackingNumber: row.tracking_number as string | undefined,
      shippedAt: row.shipped_at ? new Date(row.shipped_at as string) : undefined,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at as string) : undefined,
      returnedAt: row.returned_at ? new Date(row.returned_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapReturnRequest(row: Record<string, unknown>): ReturnRequest {
    return {
      id: row.id as string,
      deliveryGroupId: row.delivery_group_id as string,
      orderId: row.order_id as string,
      userId: row.user_id as string,
      reason: row.reason as string,
      status: row.status as ReturnRequest['status'],
      refundAmount: row.refund_amount ? parseFloat(row.refund_amount as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

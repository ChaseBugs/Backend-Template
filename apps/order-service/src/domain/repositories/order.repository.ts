import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pool';
import { Order, OrderItem, SagaState } from '../entities/order.entity';
import { OrderStatus } from '@ecommerce/shared';

export class OrderRepository {
  async create(order: Omit<Order, 'items'>, items: Omit<OrderItem, 'id'>[], client?: PoolClient): Promise<Order> {
    const db = client ?? pool;

    const orderResult = await db.query(
      `INSERT INTO orders
         (id, saga_id, user_id, status, shipping_address, total_amount, shipping_fee, discount_amount, final_amount, idempotency_key, coupon_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        order.id, order.sagaId, order.userId, order.status,
        JSON.stringify(order.shippingAddress),
        order.totalAmount, order.shippingFee, order.discountAmount, order.finalAmount, order.idempotencyKey, order.couponCode ?? null,
      ],
    );

    const createdItems: OrderItem[] = [];
    for (const item of items) {
      const itemResult = await db.query(
        `INSERT INTO order_items
           (id, order_id, product_id, agent_id, product_name, product_image, quantity, unit_price, subtotal, discount_amount, shipping_fee)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [order.id, item.productId, item.agentId, item.productName, item.productImage ?? null,
         item.quantity, item.unitPrice, item.subtotal, item.discountAmount, item.shippingFee],
      );
      createdItems.push(this.mapItem(itemResult.rows[0]));
    }

    return { ...this.mapOrder(orderResult.rows[0]), items: createdItems };
  }

  async findById(id: string, client?: PoolClient): Promise<Order | null> {
    const db = client ?? pool;
    const orderResult = await db.query(`SELECT * FROM orders WHERE id = $1`, [id]);
    if (!orderResult.rows[0]) return null;

    const itemsResult = await db.query(`SELECT * FROM order_items WHERE order_id = $1`, [id]);
    return { ...this.mapOrder(orderResult.rows[0]), items: itemsResult.rows.map(this.mapItem) };
  }

  async findBySagaId(sagaId: string, client?: PoolClient): Promise<Order | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM orders WHERE saga_id = $1`, [sagaId]);
    if (!result.rows[0]) return null;
    const itemsResult = await db.query(`SELECT * FROM order_items WHERE order_id = $1`, [result.rows[0].id]);
    return { ...this.mapOrder(result.rows[0]), items: itemsResult.rows.map(this.mapItem) };
  }

  async updateStatus(id: string, status: OrderStatus, extra?: { paymentId?: string; cancelReason?: string }, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE orders SET status = $2, payment_id = COALESCE($3, payment_id),
       cancel_reason = COALESCE($4, cancel_reason), updated_at = NOW() WHERE id = $1`,
      [id, status, extra?.paymentId ?? null, extra?.cancelReason ?? null],
    );
  }

  async findByUser(userId: string, limit: number, offset: number, client?: PoolClient): Promise<{ orders: Order[]; total: number }> {
    const db = client ?? pool;
    const [rows, count] = await Promise.all([
      db.query(`SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]),
      db.query(`SELECT COUNT(*) FROM orders WHERE user_id = $1`, [userId]),
    ]);

    const orders: Order[] = [];
    for (const row of rows.rows) {
      const itemsResult = await db.query(`SELECT * FROM order_items WHERE order_id = $1`, [row.id]);
      orders.push({ ...this.mapOrder(row), items: itemsResult.rows.map(this.mapItem) });
    }

    return { orders, total: parseInt(count.rows[0].count, 10) };
  }

  async findByAgent(agentId: string, limit: number, offset: number, client?: PoolClient): Promise<{ orders: Order[]; total: number }> {
    const db = client ?? pool;
    const [rows, count] = await Promise.all([
      db.query(
        `SELECT DISTINCT o.* FROM orders o
         JOIN order_items oi ON o.id = oi.order_id
         WHERE oi.agent_id = $1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
        [agentId, limit, offset],
      ),
      db.query(
        `SELECT COUNT(DISTINCT o.id) FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE oi.agent_id = $1`,
        [agentId],
      ),
    ]);

    const orders: Order[] = [];
    for (const row of rows.rows) {
      const itemsResult = await db.query(
        `SELECT * FROM order_items WHERE order_id = $1 AND agent_id = $2`, [row.id, agentId],
      );
      orders.push({ ...this.mapOrder(row), items: itemsResult.rows.map(this.mapItem) });
    }

    return { orders, total: parseInt(count.rows[0].count, 10) };
  }

  async getAgentSalesSummary(agentId: string, from: Date, to: Date, client?: PoolClient): Promise<{
    statusCounts: Array<{ status: string; orderCount: number; unitsSold: number; grossSales: number }>;
  }> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT o.status,
              COUNT(DISTINCT o.id)::int          AS order_count,
              COALESCE(SUM(oi.quantity), 0)::int AS units_sold,
              COALESCE(SUM(oi.subtotal), 0)::int AS gross_sales
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE oi.agent_id = $1
         AND o.created_at >= $2 AND o.created_at <= $3
         AND o.status IN ('PAID','PROCESSING','PARTIALLY_SHIPPED','SHIPPED','COMPLETED')
       GROUP BY o.status`,
      [agentId, from, to],
    );
    return {
      statusCounts: result.rows.map((row) => ({
        status: row.status as string,
        orderCount: Number(row.order_count),
        unitsSold: Number(row.units_sold),
        grossSales: Number(row.gross_sales),
      })),
    };
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string, client?: PoolClient): Promise<Order | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey]);
    return result.rows[0] ? this.findById(result.rows[0].id, client) : null;
  }

  async findCouponForUpdate(code: string, client: PoolClient): Promise<{
    id: string;
    code: string;
    discountType: 'FIXED' | 'PERCENT';
    discountValue: number;
    minOrderAmount: number;
    maxDiscountAmount?: number;
    startsAt: Date;
    expiresAt?: Date;
    usageLimit?: number;
    usedCount: number;
    perUserLimit: number;
    isActive: boolean;
  } | null> {
    const result = await client.query(`SELECT * FROM coupons WHERE code = $1 FOR UPDATE`, [code]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      discountType: row.discount_type,
      discountValue: Number(row.discount_value),
      minOrderAmount: Number(row.min_order_amount),
      maxDiscountAmount: row.max_discount_amount == null ? undefined : Number(row.max_discount_amount),
      startsAt: new Date(row.starts_at),
      expiresAt: row.expires_at == null ? undefined : new Date(row.expires_at),
      usageLimit: row.usage_limit == null ? undefined : Number(row.usage_limit),
      usedCount: Number(row.used_count),
      perUserLimit: Number(row.per_user_limit),
      isActive: Boolean(row.is_active),
    };
  }

  async countCouponRedemptions(couponId: string, userId: string, client: PoolClient): Promise<number> {
    const result = await client.query(
      `SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2`,
      [couponId, userId],
    );
    return Number(result.rows[0].count);
  }

  async recordCouponRedemption(couponId: string, orderId: string, userId: string, discountAmount: number, client: PoolClient): Promise<void> {
    await client.query(
      `INSERT INTO coupon_redemptions (coupon_id, order_id, user_id, discount_amount) VALUES ($1, $2, $3, $4)`,
      [couponId, orderId, userId, discountAmount],
    );
    await client.query(`UPDATE coupons SET used_count = used_count + 1, updated_at = NOW() WHERE id = $1`, [couponId]);
  }

  async isReviewEligible(orderId: string, userId: string, productId: string, client?: PoolClient): Promise<boolean> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT 1
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1 AND o.user_id = $2 AND oi.product_id = $3
         AND o.status = $4
       LIMIT 1`,
      [orderId, userId, productId, OrderStatus.COMPLETED],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getReturnContext(orderId: string, userId: string, agentId: string, client?: PoolClient): Promise<{ refundAmount: number } | null> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT COALESCE(SUM(oi.subtotal - oi.discount_amount + oi.shipping_fee), 0) AS refund_amount
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1 AND o.user_id = $2 AND oi.agent_id = $3
       GROUP BY o.id`,
      [orderId, userId, agentId],
    );
    if (!result.rows[0]) return null;
    return { refundAmount: parseFloat(result.rows[0].refund_amount) };
  }

  // SAGA state management
  async createSaga(saga: SagaState, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `INSERT INTO saga_states (saga_id, order_id, status, items, failure_reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [saga.sagaId, saga.orderId, saga.status, JSON.stringify(saga.items), saga.failureReason ?? null],
    );
  }

  async updateSaga(sagaId: string, status: SagaState['status'], failureReason?: string, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE saga_states SET status = $2, failure_reason = $3, updated_at = NOW() WHERE saga_id = $1`,
      [sagaId, status, failureReason ?? null],
    );
  }

  async getSaga(sagaId: string, client?: PoolClient): Promise<SagaState | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM saga_states WHERE saga_id = $1`, [sagaId]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      sagaId: row.saga_id,
      orderId: row.order_id,
      status: row.status,
      items: row.items,
      failureReason: row.failure_reason,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapOrder(row: Record<string, unknown>): Omit<Order, 'items'> {
    return {
      id: row.id as string,
      sagaId: row.saga_id as string,
      userId: row.user_id as string,
      status: row.status as OrderStatus,
      shippingAddress: typeof row.shipping_address === 'string'
        ? JSON.parse(row.shipping_address as string)
        : row.shipping_address,
      totalAmount: parseFloat(row.total_amount as string),
      shippingFee: parseFloat(row.shipping_fee as string),
      discountAmount: parseFloat(row.discount_amount as string),
      finalAmount: parseFloat(row.final_amount as string),
      paymentId: row.payment_id as string | undefined,
      cancelReason: row.cancel_reason as string | undefined,
      couponCode: row.coupon_code as string | undefined,
      idempotencyKey: row.idempotency_key as string,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapItem(row: Record<string, unknown>): OrderItem {
    return {
      id: row.id as string,
      orderId: row.order_id as string,
      productId: row.product_id as string,
      agentId: row.agent_id as string,
      productName: row.product_name as string,
      productImage: row.product_image as string | undefined,
      quantity: parseInt(row.quantity as string, 10),
      unitPrice: parseFloat(row.unit_price as string),
      subtotal: parseFloat(row.subtotal as string),
      discountAmount: parseFloat(row.discount_amount as string),
      shippingFee: parseFloat(row.shipping_fee as string),
    };
  }
}

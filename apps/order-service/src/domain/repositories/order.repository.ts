import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pool';
import { Order, OrderItem, SagaState } from '../entities/order.entity';
import { OrderStatus } from '@ecommerce/shared';

export class OrderRepository {
  async create(order: Omit<Order, 'items'>, items: Omit<OrderItem, 'id'>[], client?: PoolClient): Promise<Order> {
    const db = client ?? pool;

    const orderResult = await db.query(
      `INSERT INTO orders
         (id, saga_id, user_id, status, shipping_address, total_amount, shipping_fee, discount_amount, final_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        order.id, order.sagaId, order.userId, order.status,
        JSON.stringify(order.shippingAddress),
        order.totalAmount, order.shippingFee, order.discountAmount, order.finalAmount,
      ],
    );

    const createdItems: OrderItem[] = [];
    for (const item of items) {
      const itemResult = await db.query(
        `INSERT INTO order_items
           (id, order_id, product_id, agent_id, product_name, product_image, quantity, unit_price, subtotal)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [order.id, item.productId, item.agentId, item.productName, item.productImage ?? null,
         item.quantity, item.unitPrice, item.subtotal],
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
    };
  }
}

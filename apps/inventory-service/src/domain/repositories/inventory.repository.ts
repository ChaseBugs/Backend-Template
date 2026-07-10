import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pool';
import { Inventory, StockMovement } from '../entities/inventory.entity';

export class InventoryRepository {
  async findByProductId(productId: string, client?: PoolClient): Promise<Inventory | null> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT id, product_id, agent_id, quantity, reserved_quantity, low_stock_threshold, updated_at
       FROM inventories WHERE product_id = $1`,
      [productId],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async upsert(
    productId: string,
    agentId: string,
    quantity: number,
    client?: PoolClient,
  ): Promise<Inventory> {
    const db = client ?? pool;
    const id = `${productId}`;
    const result = await db.query(
      `INSERT INTO inventories (id, product_id, agent_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         updated_at = NOW()
       RETURNING *`,
      [id, productId, agentId, quantity],
    );
    return this.map(result.rows[0]);
  }

  async adjustQuantity(productId: string, delta: number, client?: PoolClient): Promise<Inventory> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE inventories SET quantity = quantity + $2, updated_at = NOW()
       WHERE product_id = $1
       RETURNING *`,
      [productId, delta],
    );
    return this.map(result.rows[0]);
  }

  async reserve(productId: string, quantity: number, client?: PoolClient): Promise<boolean> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE inventories
       SET reserved_quantity = reserved_quantity + $2, updated_at = NOW()
       WHERE product_id = $1 AND (quantity - reserved_quantity) >= $2
       RETURNING id`,
      [productId, quantity],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async releaseReservation(productId: string, quantity: number, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE inventories
       SET reserved_quantity = GREATEST(0, reserved_quantity - $2), updated_at = NOW()
       WHERE product_id = $1`,
      [productId, quantity],
    );
  }

  async deductReserved(productId: string, quantity: number, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE inventories
       SET quantity = quantity - $2,
           reserved_quantity = GREATEST(0, reserved_quantity - $2),
           updated_at = NOW()
       WHERE product_id = $1`,
      [productId, quantity],
    );
  }

  async findByAgent(agentId: string, limit: number, offset: number, client?: PoolClient): Promise<{ items: Inventory[]; total: number }> {
    const db = client ?? pool;
    const [rows, count] = await Promise.all([
      db.query(`SELECT * FROM inventories WHERE agent_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`, [agentId, limit, offset]),
      db.query(`SELECT COUNT(*) FROM inventories WHERE agent_id = $1`, [agentId]),
    ]);
    return { items: rows.rows.map(this.map), total: parseInt(count.rows[0].count, 10) };
  }

  async createMovement(movement: Omit<StockMovement, 'createdAt'>, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `INSERT INTO stock_movements (id, product_id, type, quantity, reference_id, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [movement.id, movement.productId, movement.type, movement.quantity, movement.referenceId ?? null, movement.note ?? null],
    );
  }

  private map(row: Record<string, unknown>): Inventory {
    return {
      id: row.id as string,
      productId: row.product_id as string,
      agentId: row.agent_id as string,
      quantity: parseInt(row.quantity as string, 10),
      reservedQuantity: parseInt(row.reserved_quantity as string, 10),
      lowStockThreshold: parseInt(row.low_stock_threshold as string, 10),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

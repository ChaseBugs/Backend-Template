import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pool';
import { Inventory, StockMovement } from '../entities/inventory.entity';

export class InventoryRepository {
  async findByProductId(productId: string, client?: PoolClient): Promise<Inventory | null> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT id, product_id, agent_id,
              quantity_available AS quantity,
              quantity_reserved AS reserved_quantity,
              low_stock_threshold, updated_at
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
  ): Promise<Inventory | null> {
    const db = client ?? pool;
    const id = `${productId}`;
    const result = await db.query(
      `INSERT INTO inventories (id, product_id, agent_id, quantity_available)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id) DO UPDATE SET
         quantity_available = EXCLUDED.quantity_available,
         updated_at = NOW()
       WHERE inventories.agent_id = EXCLUDED.agent_id
         AND EXCLUDED.quantity_available >= inventories.quantity_reserved
       RETURNING id, product_id, agent_id,
                 quantity_available AS quantity,
                 quantity_reserved AS reserved_quantity,
                 low_stock_threshold, updated_at`,
      [id, productId, agentId, quantity],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async adjustQuantity(productId: string, delta: number, client?: PoolClient): Promise<Inventory | null> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE inventories SET quantity_available = quantity_available + $2, updated_at = NOW()
       WHERE product_id = $1
         AND quantity_available + $2 >= quantity_reserved
       RETURNING id, product_id, agent_id,
                 quantity_available AS quantity,
                 quantity_reserved AS reserved_quantity,
                 low_stock_threshold, updated_at`,
      [productId, delta],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async reserve(productId: string, quantity: number, client?: PoolClient): Promise<boolean> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE inventories
       SET quantity_reserved = quantity_reserved + $2, updated_at = NOW()
       WHERE product_id = $1 AND (quantity_available - quantity_reserved) >= $2
       RETURNING id`,
      [productId, quantity],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async releaseReservation(productId: string, quantity: number, client?: PoolClient): Promise<boolean> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE inventories
       SET quantity_reserved = quantity_reserved - $2, updated_at = NOW()
       WHERE product_id = $1 AND quantity_reserved >= $2
       RETURNING id`,
      [productId, quantity],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deductReserved(productId: string, quantity: number, client?: PoolClient): Promise<Inventory> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE inventories
       SET quantity_available = quantity_available - $2,
           quantity_reserved = GREATEST(0, quantity_reserved - $2),
           updated_at = NOW()
       WHERE product_id = $1 AND quantity_reserved >= $2
       RETURNING id, product_id, agent_id,
                 quantity_available AS quantity,
                 quantity_reserved AS reserved_quantity,
                 low_stock_threshold, updated_at`,
      [productId, quantity],
    );
    if (!result.rows[0]) throw new Error(`Reserved inventory not found for product ${productId}`);
    return this.map(result.rows[0]);
  }

  async findByAgent(agentId: string, limit: number, offset: number, client?: PoolClient): Promise<{ items: Inventory[]; total: number }> {
    const db = client ?? pool;
    const [rows, count] = await Promise.all([
      db.query(`SELECT id, product_id, agent_id,
                       quantity_available AS quantity,
                       quantity_reserved AS reserved_quantity,
                       low_stock_threshold, updated_at
                FROM inventories WHERE agent_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`, [agentId, limit, offset]),
      db.query(`SELECT COUNT(*) FROM inventories WHERE agent_id = $1`, [agentId]),
    ]);
    return { items: rows.rows.map(this.map), total: parseInt(count.rows[0].count, 10) };
  }

  async getAgentInventoryHealthRows(agentId: string, client?: PoolClient): Promise<Array<{
    productId: string; quantity: number; reservedQuantity: number; lowStockThreshold: number;
  }>> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT product_id, quantity_available AS quantity,
              quantity_reserved AS reserved_quantity, low_stock_threshold
       FROM inventories WHERE agent_id = $1`,
      [agentId],
    );
    return result.rows.map((row) => ({
      productId: row.product_id as string,
      quantity: Number(row.quantity),
      reservedQuantity: Number(row.reserved_quantity),
      lowStockThreshold: Number(row.low_stock_threshold),
    }));
  }

  async createMovement(movement: Omit<StockMovement, 'createdAt'>, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `INSERT INTO stock_movements (id, product_id, type, quantity, reference_id, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [movement.id, movement.productId, movement.type, movement.quantity, movement.referenceId ?? null, movement.note ?? null],
    );
  }

  async hasMovement(productId: string, type: StockMovement['type'], referenceId: string, client?: PoolClient): Promise<boolean> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT 1 FROM stock_movements
       WHERE product_id = $1 AND type = $2 AND reference_id = $3 LIMIT 1`,
      [productId, type, referenceId],
    );
    return (result.rowCount ?? 0) > 0;
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

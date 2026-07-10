import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pg-pool';
import { Product, ProductStatus } from '../entities/product.entity';

export interface CreateProductInput {
  id: string;
  agentId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  comparePrice?: number;
  brand?: string;
  tags: string[];
  images: string[];
}

export class ProductWriteRepository {
  async create(input: CreateProductInput, client?: PoolClient): Promise<Product> {
    const db = client ?? pool;
    const result = await db.query(
      `INSERT INTO products
         (id, agent_id, category_id, name, description, price, compare_price, brand, tags, images, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING_APPROVAL')
       RETURNING *`,
      [
        input.id, input.agentId, input.categoryId, input.name, input.description,
        input.price, input.comparePrice ?? null, input.brand ?? null,
        input.tags, input.images,
      ],
    );
    return this.mapProduct(result.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<Product | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM products WHERE id = $1`, [id]);
    return result.rows[0] ? this.mapProduct(result.rows[0]) : null;
  }

  async update(
    id: string,
    agentId: string,
    fields: Partial<Pick<Product, 'name' | 'description' | 'price' | 'comparePrice' | 'brand' | 'tags' | 'images' | 'categoryId'>>,
    client?: PoolClient,
  ): Promise<Product | null> {
    const db = client ?? pool;
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const fieldMap: Record<string, string> = {
      name: 'name', description: 'description', price: 'price',
      comparePrice: 'compare_price', brand: 'brand', tags: 'tags',
      images: 'images', categoryId: 'category_id',
    };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && fieldMap[key]) {
        setClauses.push(`${fieldMap[key]} = $${idx++}`);
        values.push(value);
      }
    }

    if (!setClauses.length) return this.findById(id);

    setClauses.push(`status = 'PENDING_APPROVAL'`);
    setClauses.push(`updated_at = NOW()`);
    values.push(id, agentId);

    const result = await db.query(
      `UPDATE products SET ${setClauses.join(', ')}
       WHERE id = $${idx++} AND agent_id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0] ? this.mapProduct(result.rows[0]) : null;
  }

  async approve(id: string, approvedBy: string, client?: PoolClient): Promise<Product | null> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE products SET status = 'ACTIVE', approved_by = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, approvedBy],
    );
    return result.rows[0] ? this.mapProduct(result.rows[0]) : null;
  }

  async reject(id: string, approvedBy: string, reason: string, client?: PoolClient): Promise<Product | null> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE products SET status = 'REJECTED', approved_by = $2, rejection_reason = $3, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, approvedBy, reason],
    );
    return result.rows[0] ? this.mapProduct(result.rows[0]) : null;
  }

  async softDelete(id: string, agentId: string, client?: PoolClient): Promise<boolean> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE products SET status = 'INACTIVE', updated_at = NOW()
       WHERE id = $1 AND agent_id = $2`,
      [id, agentId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findByAgent(agentId: string, limit: number, offset: number, client?: PoolClient): Promise<{ products: Product[]; total: number }> {
    const db = client ?? pool;
    const [rows, count] = await Promise.all([
      db.query(`SELECT * FROM products WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [agentId, limit, offset]),
      db.query(`SELECT COUNT(*) FROM products WHERE agent_id = $1`, [agentId]),
    ]);
    return { products: rows.rows.map(this.mapProduct), total: parseInt(count.rows[0].count, 10) };
  }

  async findPendingApproval(limit: number, offset: number, client?: PoolClient): Promise<{ products: Product[]; total: number }> {
    const db = client ?? pool;
    const [rows, count] = await Promise.all([
      db.query(`SELECT * FROM products WHERE status = 'PENDING_APPROVAL' ORDER BY created_at ASC LIMIT $1 OFFSET $2`, [limit, offset]),
      db.query(`SELECT COUNT(*) FROM products WHERE status = 'PENDING_APPROVAL'`),
    ]);
    return { products: rows.rows.map(this.mapProduct), total: parseInt(count.rows[0].count, 10) };
  }

  private mapProduct(row: Record<string, unknown>): Product {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      categoryId: row.category_id as string,
      name: row.name as string,
      description: row.description as string,
      price: parseFloat(row.price as string),
      comparePrice: row.compare_price ? parseFloat(row.compare_price as string) : undefined,
      brand: row.brand as string | undefined,
      tags: row.tags as string[],
      images: row.images as string[],
      status: row.status as ProductStatus,
      approvedBy: row.approved_by as string | undefined,
      approvedAt: row.approved_at ? new Date(row.approved_at as string) : undefined,
      rejectionReason: row.rejection_reason as string | undefined,
      viewCount: parseInt(row.view_count as string, 10),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pg-pool';
import { Product, ProductStatus } from '../entities/product.entity';
import { createHash } from 'crypto';

export interface CreateProductInput {
  id: string;
  catalogVariantId?: string;
  catalog?: {
    gtin?: string; manufacturer?: string; modelNumber?: string;
    variantName?: string; variantGtin?: string; variantAttributes: Record<string, string>;
  };
  agentId: string;
  sku: string;
  condition: Product['condition'];
  categoryId: string;
  name: string;
  description: string;
  price: number;
  comparePrice?: number;
  brand?: string;
  tags: string[];
  images: string[];
  idempotencyKey?: string;
}

export class ProductWriteRepository {
  async searchCatalog(query: { q?: string; gtin?: string; page: number; limit: number }) {
    const conditions: string[] = ["cp.status = 'ACTIVE'"];
    const values: unknown[] = [];
    if (query.gtin) {
      values.push(query.gtin);
      conditions.push(`(cv.gtin = $${values.length} OR cp.gtin = $${values.length})`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      conditions.push(`(cp.canonical_name ILIKE $${values.length} OR cp.brand ILIKE $${values.length} OR cp.model_number ILIKE $${values.length})`);
    }
    const where = conditions.join(' AND ');
    const count = await pool.query(
      `SELECT COUNT(*) FROM product.catalog_variants cv
       JOIN product.catalog_products cp ON cp.id = cv.catalog_product_id WHERE ${where}`,
      values,
    );
    values.push(query.limit, (query.page - 1) * query.limit);
    const rows = await pool.query(
      `SELECT cv.id AS catalog_variant_id, cv.variant_name, cv.attributes, cv.gtin AS variant_gtin,
              cp.id AS catalog_product_id, cp.canonical_name, cp.brand, cp.manufacturer,
              cp.model_number, cp.gtin, cp.category_id,
              COUNT(p.id) FILTER (WHERE p.status = 'ACTIVE' AND NOT p.is_deleted) AS active_offer_count,
              MIN(p.price) FILTER (WHERE p.status = 'ACTIVE' AND NOT p.is_deleted) AS lowest_price
       FROM product.catalog_variants cv
       JOIN product.catalog_products cp ON cp.id = cv.catalog_product_id
       LEFT JOIN product.products p ON p.catalog_variant_id = cv.id
       WHERE ${where}
       GROUP BY cv.id, cp.id
       ORDER BY cp.canonical_name, cv.variant_name
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return { variants: rows.rows, total: Number(count.rows[0].count) };
  }

  async listActiveOffers(catalogVariantId: string) {
    const result = await pool.query(
      `SELECT id, catalog_variant_id, agent_id, sku AS seller_sku, condition,
              name, price, compare_price, images, status
       FROM product.products
       WHERE catalog_variant_id = $1 AND status = 'ACTIVE' AND is_deleted = FALSE
       ORDER BY price ASC, created_at ASC`,
      [catalogVariantId],
    );
    return result.rows;
  }

  async create(input: CreateProductInput, client?: PoolClient): Promise<Product> {
    if (!client) {
      const transaction = await pool.connect();
      try {
        await transaction.query('BEGIN');
        const product = await this.create(input, transaction);
        await transaction.query('COMMIT');
        return product;
      } catch (error) {
        await transaction.query('ROLLBACK');
        throw error;
      } finally {
        transaction.release();
      }
    }
    const db = client;
    const catalogVariantId = await this.resolveCatalogVariant(input, client);
    const result = await db.query(
      `INSERT INTO products
         (id, catalog_variant_id, agent_id, category_id, name, description, price, compare_price,
          brand, tags, images, sku, condition, idempotency_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'PENDING_APPROVAL')
       RETURNING *`,
      [
        input.id, catalogVariantId, input.agentId, input.categoryId, input.name, input.description,
        input.price, input.comparePrice ?? null, input.brand ?? null,
        input.tags, input.images, input.sku, input.condition, input.idempotencyKey ?? null,
      ],
    );
    return this.mapProduct(result.rows[0]);
  }

  private async resolveCatalogVariant(input: CreateProductInput, client: PoolClient): Promise<string> {
    if (input.catalogVariantId) {
      const existing = await client.query('SELECT id FROM product.catalog_variants WHERE id = $1', [input.catalogVariantId]);
      if (!existing.rows[0]) throw new Error(`Catalog variant ${input.catalogVariantId} does not exist`);
      return existing.rows[0].id as string;
    }

    const catalog = input.catalog ?? { variantAttributes: {} };
    let catalogProductId: string;
    if (catalog.gtin) {
      const result = await client.query(
        `INSERT INTO product.catalog_products
           (category_id, canonical_name, brand, manufacturer, model_number, gtin, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (gtin) WHERE gtin IS NOT NULL DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [input.categoryId, input.name, input.brand ?? null, catalog.manufacturer ?? null,
          catalog.modelNumber ?? null, catalog.gtin, input.description],
      );
      catalogProductId = result.rows[0].id;
    } else {
      const result = await client.query(
        `INSERT INTO product.catalog_products
           (category_id, canonical_name, brand, manufacturer, model_number, description)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [input.categoryId, input.name, input.brand ?? null, catalog.manufacturer ?? null,
          catalog.modelNumber ?? null, input.description],
      );
      catalogProductId = result.rows[0].id;
    }

    const attributes = Object.fromEntries(Object.entries(catalog.variantAttributes ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    const variantKey = createHash('sha256').update(JSON.stringify(attributes)).digest('hex');
    const variant = await client.query(
      `INSERT INTO product.catalog_variants
         (catalog_product_id, variant_key, variant_name, attributes, gtin)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (catalog_product_id, variant_key) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [catalogProductId, variantKey, catalog.variantName ?? input.name, JSON.stringify(attributes), catalog.variantGtin ?? null],
    );
    return variant.rows[0].id;
  }

  async findById(id: string, client?: PoolClient): Promise<Product | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM products WHERE id = $1`, [id]);
    return result.rows[0] ? this.mapProduct(result.rows[0]) : null;
  }

  async findByIdempotencyKey(agentId: string, key: string, client?: PoolClient): Promise<Product | null> {
    const db = client ?? pool;
    const result = await db.query(`SELECT * FROM products WHERE agent_id = $1 AND idempotency_key = $2`, [agentId, key]);
    return result.rows[0] ? this.mapProduct(result.rows[0]) : null;
  }

  async findActiveByIds(ids: string[], client?: PoolClient): Promise<Product[]> {
    if (ids.length === 0) return [];
    const db = client ?? pool;
    const result = await db.query(
      `SELECT * FROM products
       WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE' AND is_deleted = FALSE`,
      [ids],
    );
    return result.rows.map(this.mapProduct);
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
       WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING *`,
      [id, approvedBy],
    );
    return result.rows[0] ? this.mapProduct(result.rows[0]) : null;
  }

  async reject(id: string, approvedBy: string, reason: string, client?: PoolClient): Promise<Product | null> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE products SET status = 'REJECTED', approved_by = $2, rejection_reason = $3, updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING *`,
      [id, approvedBy, reason],
    );
    return result.rows[0] ? this.mapProduct(result.rows[0]) : null;
  }

  async softDelete(id: string, agentId: string, client?: PoolClient): Promise<boolean> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE products SET status = 'INACTIVE', updated_at = NOW()
       WHERE id = $1 AND agent_id = $2 AND status <> 'INACTIVE'`,
      [id, agentId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async softDeleteAny(id: string, client?: PoolClient): Promise<boolean> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE products SET status = 'INACTIVE', updated_at = NOW()
       WHERE id = $1 AND status <> 'INACTIVE'`,
      [id],
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
      catalogVariantId: row.catalog_variant_id as string,
      agentId: row.agent_id as string,
      sku: row.sku as string,
      condition: row.condition as Product['condition'],
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

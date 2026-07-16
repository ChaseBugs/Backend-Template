import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pool';
import { Campaign, CampaignStatus, SponsoredOffer } from '../entities/campaign.entity';
import { chargeClick } from '../../application/charge-click';

export interface CreateCampaignInput {
  agentId: string;
  productId: string;
  costPerClick: number;
  dailyBudget: number;
  totalBudget: number;
}

const SELECT_COLUMNS = `
  id, agent_id AS "agentId", product_id AS "productId",
  cost_per_click AS "costPerClick", daily_budget AS "dailyBudget", total_budget AS "totalBudget",
  spent_total AS "spentTotal", spent_today AS "spentToday", spend_date AS "spendDate",
  impression_count AS "impressionCount", click_count AS "clickCount",
  status, rejection_reason AS "rejectionReason",
  approved_by AS "approvedBy", approved_at AS "approvedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export class CampaignRepository {
  async create(input: CreateCampaignInput): Promise<Campaign> {
    const result = await pool.query(
      `INSERT INTO campaigns (agent_id, product_id, cost_per_click, daily_budget, total_budget)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SELECT_COLUMNS}`,
      [input.agentId, input.productId, input.costPerClick, input.dailyBudget, input.totalBudget],
    );
    return this.map(result.rows[0]);
  }

  async findById(id: string): Promise<Campaign | null> {
    const result = await pool.query(`SELECT ${SELECT_COLUMNS} FROM campaigns WHERE id = $1`, [id]);
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async findByAgent(agentId: string, status: CampaignStatus | undefined, limit: number, offset: number): Promise<{ rows: Campaign[]; total: number }> {
    const params: unknown[] = [agentId];
    let where = 'agent_id = $1';
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT ${SELECT_COLUMNS} FROM campaigns WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM campaigns WHERE ${where}`, params),
    ]);
    return { rows: rows.rows.map((row) => this.map(row)), total: parseInt(count.rows[0].count, 10) };
  }

  async findAll(status: CampaignStatus | undefined, limit: number, offset: number): Promise<{ rows: Campaign[]; total: number }> {
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $${params.length}`;
    }
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT ${SELECT_COLUMNS} FROM campaigns ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM campaigns ${where}`, params),
    ]);
    return { rows: rows.rows.map((row) => this.map(row)), total: parseInt(count.rows[0].count, 10) };
  }

  async findActiveByProductIds(productIds: string[]): Promise<SponsoredOffer[]> {
    if (productIds.length === 0) return [];
    const result = await pool.query(
      `SELECT id AS "campaignId", product_id AS "productId", cost_per_click AS "costPerClick"
       FROM campaigns
       WHERE product_id = ANY($1) AND status = 'ACTIVE'
         AND spent_total < total_budget
         AND (spend_date <> CURRENT_DATE OR spent_today < daily_budget)`,
      [productIds],
    );
    return result.rows;
  }

  async incrementImpressions(campaignIds: string[]): Promise<void> {
    if (campaignIds.length === 0) return;
    await pool.query(
      `UPDATE campaigns SET impression_count = impression_count + 1, updated_at = NOW() WHERE id = ANY($1)`,
      [campaignIds],
    );
  }

  async approve(id: string, approvedBy: string): Promise<Campaign | null> {
    const result = await pool.query(
      `UPDATE campaigns SET status = 'ACTIVE', approved_by = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING_APPROVAL'
       RETURNING ${SELECT_COLUMNS}`,
      [id, approvedBy],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async reject(id: string, reason: string): Promise<Campaign | null> {
    const result = await pool.query(
      `UPDATE campaigns SET status = 'REJECTED', rejection_reason = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING_APPROVAL'
       RETURNING ${SELECT_COLUMNS}`,
      [id, reason],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async pause(id: string): Promise<Campaign | null> {
    const result = await pool.query(
      `UPDATE campaigns SET status = 'PAUSED', updated_at = NOW()
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING ${SELECT_COLUMNS}`,
      [id],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async resume(id: string): Promise<Campaign | null> {
    const result = await pool.query(
      `UPDATE campaigns SET status = CASE WHEN spent_total >= total_budget THEN 'COMPLETED' ELSE 'ACTIVE' END,
              updated_at = NOW()
       WHERE id = $1 AND status = 'PAUSED'
       RETURNING ${SELECT_COLUMNS}`,
      [id],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async recordClick(campaignId: string, client?: PoolClient): Promise<Campaign | null> {
    const db = client ?? pool;
    const locked = await db.query(
      `SELECT ${SELECT_COLUMNS} FROM campaigns WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE`,
      [campaignId],
    );
    if (!locked.rows[0]) return null;
    const campaign = this.map(locked.rows[0]);

    const today = new Date().toISOString().slice(0, 10);
    const result = chargeClick(campaign, today);
    if (!result.charged) {
      if (result.newStatus !== campaign.status) {
        await db.query(`UPDATE campaigns SET status = $2, updated_at = NOW() WHERE id = $1`, [campaignId, result.newStatus]);
      }
      return null;
    }

    const updated = await db.query(
      `UPDATE campaigns
       SET spent_total = $2, spent_today = $3, spend_date = $4, click_count = click_count + 1,
           status = $5, updated_at = NOW()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [campaignId, result.spentTotal, result.spentToday, result.spendDate, result.newStatus],
    );
    return this.map(updated.rows[0]);
  }

  private map(row: any): Campaign {
    return {
      ...row,
      spendDate: row.spendDate instanceof Date ? row.spendDate.toISOString().slice(0, 10) : row.spendDate,
    };
  }
}

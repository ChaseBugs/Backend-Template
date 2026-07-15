import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';

export interface RatingProjection {
  productId: string;
  average: number;
  count: number;
}

export type RatingPublisher = (projection: RatingProjection, eventId: string) => Promise<void>;

export async function queueRatingProjection(client: Pick<PoolClient, 'query'>, productId: string): Promise<string> {
  const eventId = randomUUID();
  await client.query(
    `INSERT INTO review_rating_outbox (product_id, event_id, requested_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (product_id) DO UPDATE
       SET event_id = EXCLUDED.event_id, requested_at = EXCLUDED.requested_at`,
    [productId, eventId],
  );
  return eventId;
}

export function normalizeRatingSummary(productId: string, average: string | null, count: string): RatingProjection {
  return {
    productId,
    average: Math.round(Number(average ?? 0) * 100) / 100,
    count: Number(count),
  };
}

export async function drainRatingOutbox(pool: Pool, publish: RatingPublisher, limit = 20): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pending = await client.query<{ productId: string; eventId: string }>(
      `SELECT product_id AS "productId", event_id AS "eventId"
         FROM review_rating_outbox
        ORDER BY requested_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [limit],
    );

    for (const item of pending.rows) {
      const result = await client.query<{ average: string | null; count: string }>(
        'SELECT AVG(rating)::text AS average, COUNT(*)::text AS count FROM reviews WHERE product_id = $1',
        [item.productId],
      );
      const summary = result.rows[0] ?? { average: null, count: '0' };
      await publish(normalizeRatingSummary(item.productId, summary.average, summary.count), item.eventId);
      await client.query(
        'DELETE FROM review_rating_outbox WHERE product_id = $1 AND event_id = $2',
        [item.productId, item.eventId],
      );
    }

    await client.query('COMMIT');
    return pending.rowCount ?? pending.rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

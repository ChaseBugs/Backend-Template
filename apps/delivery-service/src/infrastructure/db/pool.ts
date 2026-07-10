import { Pool, PoolClient } from 'pg';
import { config } from '../../config';

export const pool = new Pool({
  connectionString: config.database.url,
  max: config.database.maxConnections,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', (client: PoolClient) => {
  client.query("SET search_path TO delivery, public");
});

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

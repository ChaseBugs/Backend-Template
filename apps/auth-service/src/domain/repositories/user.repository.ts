import { PoolClient } from 'pg';
import { pool } from '../../infrastructure/db/pool';
import { User, AgentProfile, AgentShippingPolicy, RefreshToken } from '../entities/user.entity';
import { UserRole, AgentApprovalStatus } from '@ecommerce/shared';

export interface CreateUserInput {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface CreateAgentProfileInput {
  id: string;
  userId: string;
  businessName: string;
  businessNumber: string;
}

export class UserRepository {
  async findById(id: string, client?: PoolClient): Promise<User | null> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT id, email, password_hash, role, first_name, last_name, phone,
              is_active, last_login_at, created_at, updated_at
       FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? this.mapUser(result.rows[0]) : null;
  }

  async findByEmail(email: string, client?: PoolClient): Promise<User | null> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT id, email, password_hash, role, first_name, last_name, phone,
              is_active, last_login_at, created_at, updated_at
       FROM users WHERE email = $1`,
      [email],
    );
    return result.rows[0] ? this.mapUser(result.rows[0]) : null;
  }

  async create(input: CreateUserInput, client?: PoolClient): Promise<User> {
    const db = client ?? pool;
    const result = await db.query(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, password_hash, role, first_name, last_name, phone,
                 is_active, last_login_at, created_at, updated_at`,
      [input.id, input.email, input.passwordHash, input.role, input.firstName, input.lastName, input.phone ?? null],
    );
    return this.mapUser(result.rows[0]);
  }

  async updateLastLogin(id: string, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
  }

  async updateActiveStatus(id: string, isActive: boolean, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(`UPDATE users SET is_active = $2, updated_at = NOW() WHERE id = $1`, [id, isActive]);
  }

  async findAll(limit: number, offset: number, client?: PoolClient): Promise<{ users: User[]; total: number }> {
    const db = client ?? pool;
    const [usersResult, countResult] = await Promise.all([
      db.query(
        `SELECT id, email, password_hash, role, first_name, last_name, phone,
                is_active, last_login_at, created_at, updated_at
         FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      db.query(`SELECT COUNT(*) FROM users`),
    ]);
    return {
      users: usersResult.rows.map(this.mapUser),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  private mapUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      email: row.email as string,
      passwordHash: row.password_hash as string,
      role: row.role as UserRole,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      phone: row.phone as string | undefined,
      isActive: row.is_active as boolean,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

export class AgentProfileRepository {
  async findByUserId(userId: string, client?: PoolClient): Promise<AgentProfile | null> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT id, user_id, business_name, business_number, commission_rate,
              approval_status, approved_by, approved_at, rejection_reason, created_at, updated_at
       FROM agent_profiles WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ? this.mapProfile(result.rows[0]) : null;
  }

  async findById(id: string, client?: PoolClient): Promise<AgentProfile | null> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT id, user_id, business_name, business_number, commission_rate,
              approval_status, approved_by, approved_at, rejection_reason, created_at, updated_at
       FROM agent_profiles WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? this.mapProfile(result.rows[0]) : null;
  }

  async create(input: CreateAgentProfileInput, client?: PoolClient): Promise<AgentProfile> {
    const db = client ?? pool;
    const result = await db.query(
      `INSERT INTO agent_profiles (id, user_id, business_name, business_number)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, business_name, business_number, commission_rate,
                 approval_status, approved_by, approved_at, rejection_reason, created_at, updated_at`,
      [input.id, input.userId, input.businessName, input.businessNumber],
    );
    return this.mapProfile(result.rows[0]);
  }

  async updateApprovalStatus(
    id: string,
    status: AgentApprovalStatus,
    approvedBy: string,
    rejectionReason?: string,
    client?: PoolClient,
  ): Promise<AgentProfile> {
    const db = client ?? pool;
    const result = await db.query(
      `UPDATE agent_profiles
       SET approval_status = $2,
           approved_by = $3,
           approved_at = CASE WHEN $2 = 'APPROVED' THEN NOW() ELSE NULL END,
           rejection_reason = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id, business_name, business_number, commission_rate,
                 approval_status, approved_by, approved_at, rejection_reason, created_at, updated_at`,
      [id, status, approvedBy, rejectionReason ?? null],
    );
    return this.mapProfile(result.rows[0]);
  }

  async findPending(limit: number, offset: number, client?: PoolClient): Promise<{ agents: AgentProfile[]; total: number }> {
    const db = client ?? pool;
    const [agentsResult, countResult] = await Promise.all([
      db.query(
        `SELECT id, user_id, business_name, business_number, commission_rate,
                approval_status, approved_by, approved_at, rejection_reason, created_at, updated_at
         FROM agent_profiles WHERE approval_status = 'PENDING'
         ORDER BY created_at ASC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      db.query(`SELECT COUNT(*) FROM agent_profiles WHERE approval_status = 'PENDING'`),
    ]);
    return {
      agents: agentsResult.rows.map(this.mapProfile),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async setCommissionRate(id: string, rate: number, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE agent_profiles SET commission_rate = $2, updated_at = NOW() WHERE id = $1`,
      [id, rate],
    );
  }

  async findShippingPolicy(agentId: string, client?: PoolClient): Promise<AgentShippingPolicy | null> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT agent_id, base_shipping_fee, free_shipping_threshold, remote_area_fee,
              supported_couriers, default_courier
       FROM agent_shipping_policies WHERE agent_id = $1`,
      [agentId],
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      agentId: row.agent_id,
      baseShippingFee: row.base_shipping_fee,
      freeShippingThreshold: row.free_shipping_threshold,
      remoteAreaFee: row.remote_area_fee,
      supportedCouriers: row.supported_couriers,
      defaultCourier: row.default_courier,
    };
  }

  async upsertShippingPolicy(policy: AgentShippingPolicy, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `INSERT INTO agent_shipping_policies
         (agent_id, base_shipping_fee, free_shipping_threshold, remote_area_fee, supported_couriers, default_courier)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agent_id) DO UPDATE SET
         base_shipping_fee = EXCLUDED.base_shipping_fee,
         free_shipping_threshold = EXCLUDED.free_shipping_threshold,
         remote_area_fee = EXCLUDED.remote_area_fee,
         supported_couriers = EXCLUDED.supported_couriers,
         default_courier = EXCLUDED.default_courier`,
      [
        policy.agentId,
        policy.baseShippingFee,
        policy.freeShippingThreshold ?? null,
        policy.remoteAreaFee,
        policy.supportedCouriers,
        policy.defaultCourier ?? null,
      ],
    );
  }

  private mapProfile(row: Record<string, unknown>): AgentProfile {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      businessName: row.business_name as string,
      businessNumber: row.business_number as string,
      commissionRate: parseFloat(row.commission_rate as string),
      approvalStatus: row.approval_status as AgentApprovalStatus,
      approvedBy: row.approved_by as string | undefined,
      approvedAt: row.approved_at ? new Date(row.approved_at as string) : undefined,
      rejectionReason: row.rejection_reason as string | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

export class RefreshTokenRepository {
  async create(token: RefreshToken, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [token.id, token.userId, token.tokenHash, token.expiresAt],
    );
  }

  async findByHash(tokenHash: string, client?: PoolClient): Promise<RefreshToken | null> {
    const db = client ?? pool;
    const result = await db.query(
      `SELECT id, user_id, token_hash, expires_at, created_at
       FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash],
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
    };
  }

  async deleteByUserId(userId: string, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
  }

  async deleteById(id: string, client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(`DELETE FROM refresh_tokens WHERE id = $1`, [id]);
  }

  async deleteExpired(client?: PoolClient): Promise<void> {
    const db = client ?? pool;
    await db.query(`DELETE FROM refresh_tokens WHERE expires_at <= NOW()`);
  }
}

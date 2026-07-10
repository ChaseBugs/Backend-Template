import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { config } from '../../config';
import { UserRole } from '@ecommerce/shared';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  agentId?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export class TokenService {
  signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.accessExpiresIn as jwt.SignOptions['expiresIn'],
      issuer: 'ecommerce-auth',
      audience: 'ecommerce-api',
    });
  }

  signRefreshToken(payload: RefreshTokenPayload): string {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.refreshExpiresIn as jwt.SignOptions['expiresIn'],
      issuer: 'ecommerce-auth',
      audience: 'ecommerce-refresh',
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, config.jwt.secret, {
      issuer: 'ecommerce-auth',
      audience: 'ecommerce-api',
    }) as AccessTokenPayload;
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    return jwt.verify(token, config.jwt.secret, {
      issuer: 'ecommerce-auth',
      audience: 'ecommerce-refresh',
    }) as RefreshTokenPayload;
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  getRefreshExpiryDate(): Date {
    const ms = this.parseDurationToMs(config.jwt.refreshExpiresIn);
    return new Date(Date.now() + ms);
  }

  private parseDurationToMs(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return value * (multipliers[unit] ?? 86400000);
  }
}

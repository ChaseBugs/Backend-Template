import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { UserRole } from '@ecommerce/shared';

export interface GatewayUser {
  id: string;
  email: string;
  role: UserRole;
  agentId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: GatewayUser;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      issuer: 'ecommerce-auth',
      audience: 'ecommerce-api',
    }) as jwt.JwtPayload;

    req.user = {
      id: payload.sub as string,
      email: payload.email,
      role: payload.role,
      agentId: payload.agentId,
    };

    // Forward user context to downstream services via headers
    req.headers['x-user-id'] = req.user.id;
    req.headers['x-user-role'] = req.user.role;
    req.headers['x-user-email'] = req.user.email;
    if (req.user.agentId) req.headers['x-agent-id'] = req.user.agentId;
  } catch {
    // Invalid token — clear auth headers so downstream doesn't trust stale data
    delete req.headers['x-user-id'];
    delete req.headers['x-user-role'];
    delete req.headers['x-user-email'];
    delete req.headers['x-agent-id'];
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }
  next();
}

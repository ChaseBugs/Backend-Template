import { Request, Response, NextFunction } from 'express';
import { TokenService } from '../../../domain/services/token.service';
import { UnauthorizedError } from '@ecommerce/errors';
import { UserRole } from '@ecommerce/shared';

const tokenService = new TokenService();

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid Authorization header'));
  }

  const token = authHeader.slice(7);
  try {
    const payload = tokenService.verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role as UserRole,
      agentId: payload.agentId,
    };
    next();
  } catch {
    next(new UnauthorizedError('Invalid or expired access token'));
  }
}

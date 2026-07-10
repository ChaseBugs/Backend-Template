import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@ecommerce/shared';
import { UnauthorizedError } from '@ecommerce/errors';

export function extractUser(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.headers['x-user-id'] as string;
  const userRole = req.headers['x-user-role'] as string;
  const userEmail = req.headers['x-user-email'] as string;
  const agentId = req.headers['x-agent-id'] as string | undefined;

  if (userId && userRole) {
    req.user = {
      id: userId,
      email: userEmail,
      role: userRole as UserRole,
      agentId,
    };
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new UnauthorizedError());
  next();
}

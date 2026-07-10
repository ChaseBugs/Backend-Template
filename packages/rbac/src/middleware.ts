import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@ecommerce/shared';
import { ForbiddenError, UnauthorizedError } from '@ecommerce/errors';
import { Permission, hasPermission } from './permissions';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  agentId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(new UnauthorizedError());
  }
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError(`Required role: ${roles.join(' or ')}`));
    }
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (!hasPermission(req.user.role, permission)) {
      return next(new ForbiddenError(`Missing permission: ${permission}`));
    }
    next();
  };
}

export function requireOwnership(getResourceOwnerId: (req: Request) => string | Promise<string>) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    // super-admin and admin bypass ownership check
    if (req.user.role === UserRole.SUPER_ADMIN || req.user.role === UserRole.ADMIN) {
      return next();
    }

    try {
      const ownerId = await getResourceOwnerId(req);
      const requesterId = req.user.role === UserRole.AGENT ? req.user.agentId : req.user.id;

      if (ownerId !== requesterId) {
        return next(new ForbiddenError('You do not own this resource'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAgentOwnership(getAgentId: (req: Request) => string | Promise<string>) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (req.user.role === UserRole.SUPER_ADMIN || req.user.role === UserRole.ADMIN) {
      return next();
    }

    if (req.user.role !== UserRole.AGENT) {
      return next(new ForbiddenError('Agent access required'));
    }

    try {
      const resourceAgentId = await getAgentId(req);
      if (resourceAgentId !== req.user.agentId) {
        return next(new ForbiddenError('You do not own this resource'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

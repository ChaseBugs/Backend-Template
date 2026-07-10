import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '@ecommerce/rbac';
import { Permission } from '@ecommerce/rbac';
import { UserRepository } from '../../../domain/repositories/user.repository';
import { successResponse, buildPagination, buildPaginatedResult } from '@ecommerce/shared';
import { NotFoundError } from '@ecommerce/errors';

export function createUserRouter(userRepo: UserRepository): Router {
  const router = Router();

  router.get(
    '/',
    authenticate,
    requirePermission(Permission.READ_ALL_USERS),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { page, limit, offset } = buildPagination(req.query);
        const { users, total } = await userRepo.findAll(limit, offset);
        const safeUsers = users.map(({ passwordHash: _, ...u }) => u);
        res.json(successResponse(buildPaginatedResult(safeUsers, total, page, limit)));
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:userId/deactivate',
    authenticate,
    requirePermission(Permission.UPDATE_ANY_USER),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.params.userId as string;
        const user = await userRepo.findById(userId);
        if (!user) throw new NotFoundError('User', userId);
        await userRepo.updateActiveStatus(userId, false);
        res.json(successResponse({ message: 'User deactivated' }));
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:userId/activate',
    authenticate,
    requirePermission(Permission.UPDATE_ANY_USER),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.params.userId as string;
        const user = await userRepo.findById(userId);
        if (!user) throw new NotFoundError('User', userId);
        await userRepo.updateActiveStatus(userId, true);
        res.json(successResponse({ message: 'User activated' }));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

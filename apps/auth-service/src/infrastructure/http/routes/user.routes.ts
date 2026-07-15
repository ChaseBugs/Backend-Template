import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '@ecommerce/rbac';
import { Permission } from '@ecommerce/rbac';
import { UserRepository } from '../../../domain/repositories/user.repository';
import { successResponse, buildPagination, buildPaginatedResult, UserRole } from '@ecommerce/shared';
import { NotFoundError, ForbiddenError } from '@ecommerce/errors';
import { ChangeUserRoleSchema } from '../../../application/dtos/auth.dto';
import { ChangeUserRoleUseCase } from '../../../application/use-cases/change-user-role.use-case';
import { ManageUserStatusUseCase } from '../../../application/use-cases/manage-user-status.use-case';
import { validate } from '../middleware/validate';

export function createUserRouter(userRepo: UserRepository, changeUserRole: ChangeUserRoleUseCase, manageUserStatus: ManageUserStatusUseCase): Router {
  const router = Router();

  router.get(
    '/:userId',
    authenticate,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.params.userId as string;
        const isAdmin = req.user!.role === UserRole.ADMIN || req.user!.role === UserRole.SUPER_ADMIN;
        if (!isAdmin && req.user!.id !== userId) throw new ForbiddenError('You can only view your own profile');
        const user = await userRepo.findById(userId);
        if (!user) throw new NotFoundError('User', userId);
        const { passwordHash: _, ...safeUser } = user;
        res.json(successResponse(safeUser));
      } catch (err) {
        next(err);
      }
    },
  );

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
    '/:userId/role',
    authenticate,
    requirePermission(Permission.CHANGE_USER_ROLE),
    validate(ChangeUserRoleSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await changeUserRole.execute(req.params.userId as string, req.body.role, req.user!.id);
        res.json(successResponse({ message: 'User role updated' }));
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
        await manageUserStatus.execute(userId, false, req.user!.id, req.user!.role);
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
        await manageUserStatus.execute(userId, true, req.user!.id, req.user!.role);
        res.json(successResponse({ message: 'User activated' }));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

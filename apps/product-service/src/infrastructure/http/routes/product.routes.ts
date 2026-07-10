import { Router } from 'express';
import { ProductController } from '../controllers/product.controller';
import { extractUser, requireAuth } from '../middleware/extract-user';
import { requirePermission, requireRole } from '@ecommerce/rbac';
import { Permission } from '@ecommerce/rbac';
import { UserRole } from '@ecommerce/shared';
import { validate } from '../middleware/validate';
import {
  CreateProductSchema,
  UpdateProductSchema,
  RejectProductSchema,
  ProductListQuerySchema,
} from '../../../application/dtos/product.dto';

export function createProductRouter(controller: ProductController): Router {
  const router = Router();

  router.use(extractUser);

  // Public
  router.get('/', validate(ProductListQuerySchema, 'query'), controller.list);
  router.get('/pending', requireAuth, requirePermission(Permission.APPROVE_PRODUCT), controller.listPending);
  router.get('/my', requireAuth, requireRole(UserRole.AGENT), controller.listMyProducts);
  router.get('/:id', controller.getById);

  // Agent: create / update / delete own products
  router.post('/', requireAuth, requireRole(UserRole.AGENT), validate(CreateProductSchema), controller.create);
  router.patch('/:id', requireAuth, requireRole(UserRole.AGENT), validate(UpdateProductSchema), controller.update);
  router.delete('/:id', requireAuth, requireRole(UserRole.AGENT), controller.delete);

  // Admin / Super-Admin: approve / reject
  router.patch('/:id/approve', requireAuth, requirePermission(Permission.APPROVE_PRODUCT), controller.approve);
  router.patch('/:id/reject', requireAuth, requirePermission(Permission.REJECT_PRODUCT), validate(RejectProductSchema), controller.reject);

  return router;
}

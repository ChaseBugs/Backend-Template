import { Router } from 'express';
import { ProductController } from '../controllers/product.controller';
import { extractUser, requireAuth } from '../middleware/extract-user';
import { requireApprovedAgent, requirePermission, requireRole } from '@ecommerce/rbac';
import { Permission } from '@ecommerce/rbac';
import { UserRole } from '@ecommerce/shared';
import { validate } from '../middleware/validate';
import {
  CreateProductSchema,
  UpdateProductSchema,
  RejectProductSchema,
  ProductListQuerySchema,
  CatalogSearchQuerySchema,
} from '../../../application/dtos/product.dto';

export function createProductRouter(controller: ProductController): Router {
  const router = Router();

  router.use(extractUser);

  // Public
  router.get('/catalog/search', validate(CatalogSearchQuerySchema, 'query'), controller.searchCatalog);
  router.get('/catalog/variants/:variantId/offers', controller.listCatalogOffers);
  router.get('/', validate(ProductListQuerySchema, 'query'), controller.list);
  router.get('/pending', requireAuth, requirePermission(Permission.APPROVE_PRODUCT), controller.listPending);
  router.get('/my', requireAuth, requireRole(UserRole.AGENT), controller.listMyProducts);
  router.get('/:id', controller.getById);

  // Agent: create / update / delete own products
  router.post('/', requireAuth, requireApprovedAgent, validate(CreateProductSchema), controller.create);
  router.patch('/:id', requireAuth, requireApprovedAgent, validate(UpdateProductSchema), controller.update);
  router.delete('/:id', requireAuth, requireApprovedAgent, controller.delete);

  // Admin / Super-Admin: approve / reject
  router.patch('/:id/approve', requireAuth, requirePermission(Permission.APPROVE_PRODUCT), controller.approve);
  router.patch('/:id/reject', requireAuth, requirePermission(Permission.REJECT_PRODUCT), validate(RejectProductSchema), controller.reject);

  return router;
}

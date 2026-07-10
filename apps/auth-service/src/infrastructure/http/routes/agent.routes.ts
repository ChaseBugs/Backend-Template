import { Router } from 'express';
import { AgentController } from '../controllers/agent.controller';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { requirePermission, requireRole } from '@ecommerce/rbac';
import { Permission } from '@ecommerce/rbac';
import { UserRole } from '@ecommerce/shared';
import {
  ApproveAgentSchema,
  RejectAgentSchema,
  UpdateShippingPolicySchema,
} from '../../../application/dtos/auth.dto';

export function createAgentRouter(controller: AgentController): Router {
  const router = Router();

  // admin/super-admin routes
  router.get(
    '/pending',
    authenticate,
    requirePermission(Permission.APPROVE_AGENT),
    controller.getPendingAgents,
  );

  router.patch(
    '/:agentId/approve',
    authenticate,
    requirePermission(Permission.APPROVE_AGENT),
    validate(ApproveAgentSchema),
    controller.approve,
  );

  router.patch(
    '/:agentId/reject',
    authenticate,
    requirePermission(Permission.REJECT_AGENT),
    validate(RejectAgentSchema),
    controller.reject,
  );

  // agent-only routes
  router.get('/me', authenticate, requireRole(UserRole.AGENT), controller.getMyProfile);

  router.get(
    '/shipping-policy',
    authenticate,
    requireRole(UserRole.AGENT),
    controller.getShippingPolicy,
  );

  router.put(
    '/shipping-policy',
    authenticate,
    requireRole(UserRole.AGENT),
    validate(UpdateShippingPolicySchema),
    controller.updateShippingPolicy,
  );

  // public: get shipping policy by agent ID (used by delivery-service internally)
  router.get('/:agentId/shipping-policy', controller.getShippingPolicy);

  return router;
}

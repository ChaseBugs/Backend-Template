import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { requireAuth } from '@ecommerce/rbac';
import { LoginSchema, RegisterUserSchema, RefreshTokenSchema } from '../../../application/dtos/auth.dto';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  router.post('/register', validate(RegisterUserSchema), controller.register);
  router.post('/login', validate(LoginSchema), controller.login);
  router.post('/refresh', validate(RefreshTokenSchema), controller.refresh);
  router.get('/me', authenticate, requireAuth, controller.me);

  return router;
}

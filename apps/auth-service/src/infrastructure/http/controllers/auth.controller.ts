import { Request, Response, NextFunction } from 'express';
import { RegisterUseCase } from '../../../application/use-cases/register.use-case';
import { LoginUseCase } from '../../../application/use-cases/login.use-case';
import { RefreshTokenUseCase } from '../../../application/use-cases/refresh-token.use-case';
import { CreateAdminUseCase } from '../../../application/use-cases/create-admin.use-case';
import { successResponse } from '@ecommerce/shared';

export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly createAdminUseCase: CreateAdminUseCase,
  ) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.registerUseCase.execute(req.body);
      res.status(201).json(successResponse(result));
    } catch (err) {
      next(err);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.loginUseCase.execute(req.body);
      res.json(successResponse(result));
    } catch (err) {
      next(err);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.refreshTokenUseCase.execute(req.body.refreshToken);
      res.json(successResponse(result));
    } catch (err) {
      next(err);
    }
  };

  me = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(req.user));
  };

  createAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.createAdminUseCase.execute(req.body);
      res.status(201).json(successResponse(result));
    } catch (err) {
      next(err);
    }
  };
}

import { Request, Response, NextFunction } from 'express';
import { RegisterUseCase } from '../../../application/use-cases/register.use-case';
import { LoginUseCase } from '../../../application/use-cases/login.use-case';
import { RefreshTokenUseCase } from '../../../application/use-cases/refresh-token.use-case';
import { CreateAdminUseCase } from '../../../application/use-cases/create-admin.use-case';
import { LogoutUseCase } from '../../../application/use-cases/logout.use-case';
import { successResponse } from '@ecommerce/shared';
import { UserRepository } from '../../../domain/repositories/user.repository';
import { NotFoundError } from '@ecommerce/errors';

export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly createAdminUseCase: CreateAdminUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly userRepo: UserRepository,
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

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.logoutUseCase.execute(req.body.refreshToken, req.user!.id);
      res.json(successResponse({ message: 'Logged out' }));
    } catch (err) {
      next(err);
    }
  };

  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.userRepo.findById(req.user!.id);
      if (!user) throw new NotFoundError('User', req.user!.id);
      const { passwordHash: _, ...safeUser } = user;
      res.json(successResponse(safeUser));
    } catch (err) {
      next(err);
    }
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

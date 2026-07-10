import { Request, Response, NextFunction } from 'express';
import { ProductUseCases } from '../../../application/use-cases/product.use-cases';
import { successResponse, buildPaginatedResult, buildPagination } from '@ecommerce/shared';
import { ForbiddenError } from '@ecommerce/errors';

const p = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

export class ProductController {
  constructor(private readonly useCases: ProductUseCases) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const agentId = req.user!.agentId;
      if (!agentId) throw new ForbiddenError('Agent ID required');
      const result = await this.useCases.create(req.body, agentId);
      res.status(201).json(successResponse(result));
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const product = await this.useCases.getById(p(req.params.id));
      res.json(successResponse(product));
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as any;
      const { products, total } = await this.useCases.list(query);
      const { page, limit } = buildPagination(req.query);
      res.json(successResponse(buildPaginatedResult(products, total, page, limit)));
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const agentId = req.user!.agentId;
      if (!agentId) throw new ForbiddenError('Agent ID required');
      await this.useCases.update(p(req.params.id), req.body, agentId);
      res.json(successResponse({ message: 'Product updated, pending re-approval' }));
    } catch (err) {
      next(err);
    }
  };

  approve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.useCases.approve(p(req.params.id), req.user!.id);
      res.json(successResponse({ message: 'Product approved' }));
    } catch (err) {
      next(err);
    }
  };

  reject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.useCases.reject(p(req.params.id), req.user!.id, req.body);
      res.json(successResponse({ message: 'Product rejected' }));
    } catch (err) {
      next(err);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const agentId = req.user!.agentId;
      if (!agentId) throw new ForbiddenError('Agent ID required');
      await this.useCases.delete(p(req.params.id), agentId);
      res.json(successResponse({ message: 'Product deleted' }));
    } catch (err) {
      next(err);
    }
  };

  listPending = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit } = buildPagination(req.query);
      const { products, total } = await this.useCases.listPendingApproval(page, limit);
      res.json(successResponse(buildPaginatedResult(products, total, page, limit)));
    } catch (err) {
      next(err);
    }
  };

  listMyProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const agentId = req.user!.agentId;
      if (!agentId) throw new ForbiddenError('Agent ID required');
      const { page, limit } = buildPagination(req.query);
      const { products, total } = await this.useCases.listByAgent(agentId, page, limit);
      res.json(successResponse(buildPaginatedResult(products, total, page, limit)));
    } catch (err) {
      next(err);
    }
  };
}

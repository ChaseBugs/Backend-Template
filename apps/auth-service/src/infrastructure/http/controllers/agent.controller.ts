import { Request, Response, NextFunction } from 'express';
import { AgentApprovalUseCase } from '../../../application/use-cases/agent-approval.use-case';
import { AgentProfileRepository } from '../../../domain/repositories/user.repository';
import { successResponse, buildPagination, buildPaginatedResult } from '@ecommerce/shared';
import { NotFoundError } from '@ecommerce/errors';

export class AgentController {
  constructor(
    private readonly agentApprovalUseCase: AgentApprovalUseCase,
    private readonly agentProfileRepo: AgentProfileRepository,
  ) {}

  getPendingAgents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit } = buildPagination(req.query);
      const { agents, total } = await this.agentApprovalUseCase.getPendingAgents(page, limit);
      res.json(successResponse(buildPaginatedResult(agents, total, page, limit)));
    } catch (err) {
      next(err);
    }
  };

  getAgentsByStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit, offset } = buildPagination(req.query);
      const status = (req.query.status as string | undefined)?.toUpperCase() ?? 'PENDING';
      const allowed = ['PENDING', 'APPROVED', 'REJECTED'];
      if (!allowed.includes(status)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: 'status must be PENDING, APPROVED, or REJECTED' } });
        return;
      }
      const { agents, total } = await this.agentProfileRepo.findByStatus(status, limit, offset);
      res.json(successResponse(buildPaginatedResult(agents, total, page, limit)));
    } catch (err) {
      next(err);
    }
  };

  approve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.agentApprovalUseCase.approve(req.params.agentId as string, req.user!.id, req.body);
      res.json(successResponse({ message: 'Agent approved successfully' }));
    } catch (err) {
      next(err);
    }
  };

  reject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.agentApprovalUseCase.reject(req.params.agentId as string, req.user!.id, req.body);
      res.json(successResponse({ message: 'Agent rejected' }));
    } catch (err) {
      next(err);
    }
  };

  getMyProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profile = await this.agentProfileRepo.findByUserId(req.user!.id);
      if (!profile) throw new NotFoundError('Agent profile');
      res.json(successResponse(profile));
    } catch (err) {
      next(err);
    }
  };

  getShippingPolicy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const agentId = (req.params.agentId as string | undefined) ?? req.user!.agentId;
      if (!agentId) throw new NotFoundError('Agent ID');
      const policy = await this.agentProfileRepo.findShippingPolicy(agentId);
      res.json(successResponse(policy));
    } catch (err) {
      next(err);
    }
  };

  updateShippingPolicy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const agentId = req.user!.agentId!;
      await this.agentProfileRepo.upsertShippingPolicy({ agentId, ...req.body });
      res.json(successResponse({ message: 'Shipping policy updated' }));
    } catch (err) {
      next(err);
    }
  };
}

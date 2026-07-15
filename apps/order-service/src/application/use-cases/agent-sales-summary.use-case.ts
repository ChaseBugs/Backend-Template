import { BadRequestError } from '@ecommerce/errors';

export interface AgentStatusCount {
  status: string;
  orderCount: number;
  unitsSold: number;
  grossSales: number;
}

export interface AgentSalesSummaryRepo {
  getAgentSalesSummary(agentId: string, from: Date, to: Date): Promise<{ statusCounts: AgentStatusCount[] }>;
}

export interface AgentSalesSummary {
  period: { from: string; to: string };
  totals: { orderCount: number; unitsSold: number; grossSales: number };
  byStatus: Record<string, { orderCount: number; unitsSold: number; grossSales: number }>;
  pendingFulfillment: number;
}

// Orders in these states still owe the seller a shipment, so they drive the
// dashboard's "to fulfill" tile.
const FULFILLABLE_STATUSES = ['PAID', 'PROCESSING', 'PARTIALLY_SHIPPED'];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class GetAgentSalesSummaryUseCase {
  constructor(private readonly repo: AgentSalesSummaryRepo) {}

  async execute(agentId: string, range?: { from?: Date; to?: Date }): Promise<AgentSalesSummary> {
    const to = range?.to ?? new Date();
    const from = range?.from ?? new Date(to.getTime() - THIRTY_DAYS_MS);
    if (from.getTime() > to.getTime()) throw new BadRequestError('from must be on or before to');

    const { statusCounts } = await this.repo.getAgentSalesSummary(agentId, from, to);

    const byStatus: AgentSalesSummary['byStatus'] = {};
    const totals = { orderCount: 0, unitsSold: 0, grossSales: 0 };
    let pendingFulfillment = 0;

    for (const row of statusCounts) {
      byStatus[row.status] = { orderCount: row.orderCount, unitsSold: row.unitsSold, grossSales: row.grossSales };
      totals.orderCount += row.orderCount;
      totals.unitsSold += row.unitsSold;
      totals.grossSales += row.grossSales;
      if (FULFILLABLE_STATUSES.includes(row.status)) pendingFulfillment += row.orderCount;
    }

    return { period: { from: from.toISOString(), to: to.toISOString() }, totals, byStatus, pendingFulfillment };
  }
}

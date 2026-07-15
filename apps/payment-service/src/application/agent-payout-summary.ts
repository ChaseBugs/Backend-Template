export interface SettlementStatusRow {
  status: string;
  count: number;
  netAmount: number;
  grossAmount: number;
  commissionAmount: number;
}

export interface AgentPayoutSummary {
  byStatus: Record<string, { count: number; netAmount: number; grossAmount: number; commissionAmount: number }>;
  payoutPending: number;
  paidOut: number;
  held: number;
  lifetimeCommission: number;
}

// Net owed to the seller but not yet paid.
const PENDING_STATUSES = ['PENDING', 'PROCESSING'];

export function buildAgentPayoutSummary(rows: SettlementStatusRow[]): AgentPayoutSummary {
  const summary: AgentPayoutSummary = {
    byStatus: {},
    payoutPending: 0,
    paidOut: 0,
    held: 0,
    lifetimeCommission: 0,
  };

  for (const row of rows) {
    summary.byStatus[row.status] = {
      count: row.count,
      netAmount: row.netAmount,
      grossAmount: row.grossAmount,
      commissionAmount: row.commissionAmount,
    };
    if (PENDING_STATUSES.includes(row.status)) summary.payoutPending += row.netAmount;
    if (row.status === 'COMPLETED') summary.paidOut += row.netAmount;
    if (row.status === 'HELD') summary.held += row.netAmount;
    if (row.status !== 'CANCELLED') summary.lifetimeCommission += row.commissionAmount;
  }

  return summary;
}

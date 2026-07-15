export interface RefundSettlement {
  id: string;
  agentId: string;
  grossAmount: number;
  commissionAmount: number;
  netAmount: number;
  status: string;
}

export interface SettlementAdjustmentAllocation {
  settlementId: string;
  agentId: string;
  grossAmount: number;
  commissionReversal: number;
  netAmount: number;
  requiresClawback: boolean;
}

export function allocateRefundToSettlements(
  refundAmount: number,
  settlements: RefundSettlement[],
  agentId?: string,
): SettlementAdjustmentAllocation[] {
  const eligible = settlements
    .filter((settlement) => !agentId || settlement.agentId === agentId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const totalGross = eligible.reduce((sum, settlement) => sum + settlement.grossAmount, 0);
  if (!Number.isInteger(refundAmount) || refundAmount <= 0 || totalGross <= 0) return [];

  let remaining = Math.min(refundAmount, totalGross);
  let remainingGross = totalGross;
  return eligible.map((settlement, index) => {
    const grossAmount = index === eligible.length - 1
      ? remaining
      : Math.min(remaining, Math.round(remaining * settlement.grossAmount / remainingGross));
    remaining -= grossAmount;
    remainingGross -= settlement.grossAmount;
    const netAmount = Math.min(grossAmount, Math.round(grossAmount * settlement.netAmount / settlement.grossAmount));
    return {
      settlementId: settlement.id,
      agentId: settlement.agentId,
      grossAmount,
      commissionReversal: grossAmount - netAmount,
      netAmount,
      requiresClawback: settlement.status === 'COMPLETED',
    };
  }).filter((allocation) => allocation.grossAmount > 0);
}

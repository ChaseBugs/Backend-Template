export interface ChargeableCampaign {
  costPerClick: number;
  dailyBudget: number;
  totalBudget: number;
  spentTotal: number;
  spentToday: number;
  spendDate: string; // YYYY-MM-DD
}

export interface ChargeResult {
  spentTotal: number;
  spentToday: number;
  spendDate: string;
  clickCountDelta: 0 | 1;
  newStatus: 'ACTIVE' | 'COMPLETED';
  charged: boolean;
}

// `today` is passed in (rather than read via `new Date()` inside) so the day-rollover
// behavior is deterministic and unit-testable without faking the system clock.
export function chargeClick(campaign: ChargeableCampaign, today: string): ChargeResult {
  const spentToday = campaign.spendDate === today ? campaign.spentToday : 0;
  const dailyExhausted = spentToday >= campaign.dailyBudget;
  const totalExhausted = campaign.spentTotal >= campaign.totalBudget;

  if (totalExhausted || dailyExhausted) {
    return {
      spentTotal: campaign.spentTotal,
      spentToday,
      spendDate: today,
      clickCountDelta: 0,
      newStatus: totalExhausted ? 'COMPLETED' : 'ACTIVE',
      charged: false,
    };
  }

  const spentTotal = campaign.spentTotal + campaign.costPerClick;
  return {
    spentTotal,
    spentToday: spentToday + campaign.costPerClick,
    spendDate: today,
    clickCountDelta: 1,
    newStatus: spentTotal >= campaign.totalBudget ? 'COMPLETED' : 'ACTIVE',
    charged: true,
  };
}

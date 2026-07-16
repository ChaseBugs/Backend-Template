export type CampaignStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'PAUSED' | 'REJECTED' | 'COMPLETED';

export interface Campaign {
  id: string;
  agentId: string;
  productId: string;
  costPerClick: number;
  dailyBudget: number;
  totalBudget: number;
  spentTotal: number;
  spentToday: number;
  spendDate: string;
  impressionCount: number;
  clickCount: number;
  status: CampaignStatus;
  rejectionReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SponsoredOffer {
  campaignId: string;
  productId: string;
  costPerClick: number;
}

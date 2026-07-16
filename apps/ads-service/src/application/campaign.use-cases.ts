import { ForbiddenError, NotFoundError, ServiceUnavailableError } from '@ecommerce/errors';
import { config } from '../config';
import { withTransaction } from '../infrastructure/db/pool';
import { CampaignRepository, CreateCampaignInput } from '../domain/repositories/campaign.repository';
import { Campaign } from '../domain/entities/campaign.entity';

async function resolveProductOwner(productId: string): Promise<string> {
  const response = await fetch(`${config.services.productUrl}/internal/products/${encodeURIComponent(productId)}/ownership`, {
    headers: { 'x-internal-service-token': config.internalServiceToken },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) throw new NotFoundError('Product', productId);
  if (!response.ok) throw new ServiceUnavailableError('Product service');
  const body = await response.json() as { data?: { agentId: string } };
  if (!body.data?.agentId) throw new ServiceUnavailableError('Product service');
  return body.data.agentId;
}

export class CampaignUseCases {
  constructor(private readonly repo: CampaignRepository) {}

  async createCampaign(agentId: string, input: Omit<CreateCampaignInput, 'agentId'>): Promise<Campaign> {
    const ownerAgentId = await resolveProductOwner(input.productId);
    if (ownerAgentId !== agentId) throw new ForbiddenError('You do not own this product');
    return this.repo.create({ ...input, agentId });
  }

  // Charges the click inside a row-locked transaction so concurrent clicks on the
  // same campaign can't both slip past the budget check (classic race condition
  // this project already guards against elsewhere via Redis locks / SELECT FOR UPDATE).
  async recordClick(campaignId: string): Promise<{ charged: boolean }> {
    const updated = await withTransaction((client) => this.repo.recordClick(campaignId, client));
    return { charged: updated !== null };
  }
}

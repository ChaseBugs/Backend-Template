import { v4 as uuidv4 } from 'uuid';
import { DeliveryRepository } from '../../domain/repositories/delivery.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { KafkaTopic, DeliveryGroupStatus } from '@ecommerce/shared';
import { NotFoundError, ForbiddenError, BadRequestError } from '@ecommerce/errors';
import { withTransaction } from '../../infrastructure/db/pool';
import { Logger } from '@ecommerce/logger';

interface CreateDeliveryGroupsInput {
  orderId: string;
  items: Array<{ productId: string; agentId: string; quantity: number }>;
}

export class DeliveryUseCases {
  constructor(
    private readonly repo: DeliveryRepository,
    private readonly kafkaProducer: KafkaProducer,
    private readonly logger: Logger,
  ) {}

  // Called after PAYMENT_COMPLETED — creates one DeliveryGroup per agent
  async createGroupsForOrder(input: CreateDeliveryGroupsInput): Promise<void> {
    // Group items by agentId
    const byAgent = new Map<string, Array<{ productId: string; quantity: number }>>();
    for (const item of input.items) {
      if (!byAgent.has(item.agentId)) byAgent.set(item.agentId, []);
      byAgent.get(item.agentId)!.push({ productId: item.productId, quantity: item.quantity });
    }

    await withTransaction(async (client) => {
      for (const [agentId, agentItems] of byAgent.entries()) {
        const groupId = uuidv4();
        const group = await this.repo.createGroup(
          {
            id: groupId,
            orderId: input.orderId,
            agentId,
            status: DeliveryGroupStatus.PREPARING,
            shippingFee: 0, // will be calculated from agent shipping policy
          },
          agentItems.map((i) => ({ deliveryGroupId: groupId, productId: i.productId, quantity: i.quantity })),
          client,
        );

        await this.kafkaProducer.send(
          KafkaTopic.DELIVERY_GROUP_CREATED,
          {
            topic: KafkaTopic.DELIVERY_GROUP_CREATED,
            payload: {
              deliveryGroupId: group.id,
              orderId: input.orderId,
              agentId,
              items: agentItems,
              shippingFee: 0,
            },
          },
          group.id,
        );
      }
    });
  }

  // Agent marks shipment with tracking number
  async ship(deliveryGroupId: string, agentId: string, courierName: string, trackingNumber: string): Promise<void> {
    const group = await this.repo.findById(deliveryGroupId);
    if (!group) throw new NotFoundError('DeliveryGroup', deliveryGroupId);
    if (group.agentId !== agentId) throw new ForbiddenError('You do not own this delivery group');
    if (group.status !== DeliveryGroupStatus.PREPARING) {
      throw new BadRequestError(`Cannot ship a delivery group in status: ${group.status}`);
    }

    const shippedAt = new Date();
    await this.repo.updateStatus(deliveryGroupId, DeliveryGroupStatus.SHIPPED, { courierName, trackingNumber, shippedAt });

    await this.kafkaProducer.send(
      KafkaTopic.DELIVERY_SHIPPED,
      {
        topic: KafkaTopic.DELIVERY_SHIPPED,
        payload: {
          deliveryGroupId,
          orderId: group.orderId,
          agentId,
          courierName,
          trackingNumber,
          shippedAt: shippedAt.toISOString(),
        },
      },
      deliveryGroupId,
    );
  }

  // Mark as delivered — agent who owns the group, or admin/super-admin (webhook path)
  async markDelivered(deliveryGroupId: string, agentId?: string): Promise<void> {
    const group = await this.repo.findById(deliveryGroupId);
    if (!group) throw new NotFoundError('DeliveryGroup', deliveryGroupId);
    if (agentId && group.agentId !== agentId) throw new ForbiddenError('You do not own this delivery group');

    const deliveredAt = new Date();
    await this.repo.updateStatus(deliveryGroupId, DeliveryGroupStatus.DELIVERED, { deliveredAt });

    await this.kafkaProducer.send(
      KafkaTopic.DELIVERY_DELIVERED,
      {
        topic: KafkaTopic.DELIVERY_DELIVERED,
        payload: { deliveryGroupId, orderId: group.orderId, deliveredAt: deliveredAt.toISOString() },
      },
      deliveryGroupId,
    );

    // Check if all groups for this order are delivered
    const total = await this.repo.countByOrder(group.orderId);
    const delivered = await this.repo.countByOrderAndStatus(group.orderId, DeliveryGroupStatus.DELIVERED);
    if (delivered >= total) {
      await this.kafkaProducer.send(
        KafkaTopic.ALL_DELIVERIES_COMPLETED,
        {
          topic: KafkaTopic.ALL_DELIVERIES_COMPLETED,
          payload: { orderId: group.orderId, completedAt: new Date().toISOString() },
        },
        group.orderId,
      );
    }
  }

  // User requests return
  async requestReturn(deliveryGroupId: string, userId: string, reason: string, refundAmount?: number): Promise<void> {
    const group = await this.repo.findById(deliveryGroupId);
    if (!group) throw new NotFoundError('DeliveryGroup', deliveryGroupId);
    if (group.status !== DeliveryGroupStatus.DELIVERED) {
      throw new BadRequestError('Can only return delivered items');
    }

    const returnRequest = await this.repo.createReturnRequest({
      id: uuidv4(),
      deliveryGroupId,
      orderId: group.orderId,
      userId,
      reason,
      status: 'PENDING',
      refundAmount,
    });

    await this.repo.updateStatus(deliveryGroupId, DeliveryGroupStatus.RETURN_REQUESTED);

    await this.kafkaProducer.send(
      KafkaTopic.RETURN_REQUESTED,
      {
        topic: KafkaTopic.RETURN_REQUESTED,
        payload: {
          returnRequestId: returnRequest.id,
          deliveryGroupId,
          orderId: group.orderId,
          userId,
          refundAmount: refundAmount ?? 0,
          reason,
        },
      },
      deliveryGroupId,
    );
  }

  async getGroupsByOrder(orderId: string): Promise<ReturnType<DeliveryRepository['findByOrderId']>> {
    return this.repo.findByOrderId(orderId);
  }

  async getAgentGroups(agentId: string, page: number, limit: number) {
    const offset = (page - 1) * limit;
    return this.repo.findByAgent(agentId, limit, offset);
  }
}

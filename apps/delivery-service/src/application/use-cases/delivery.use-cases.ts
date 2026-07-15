import { v4 as uuidv4 } from 'uuid';
import { DeliveryRepository } from '../../domain/repositories/delivery.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { KafkaTopic, DeliveryGroupStatus } from '@ecommerce/shared';
import { NotFoundError, ForbiddenError, BadRequestError } from '@ecommerce/errors';
import { withTransaction } from '../../infrastructure/db/pool';
import { Logger } from '@ecommerce/logger';

interface CreateDeliveryGroupsInput {
  orderId: string;
  userId: string;
  paymentId: string;
  items: Array<{ productId: string; agentId: string; quantity: number; shippingFee: number }>;
}

interface DeliveryMetrics {
  recordAgentOrder(agentId: string): void;
}

export class DeliveryUseCases {
  constructor(
    private readonly repo: DeliveryRepository,
    private readonly kafkaProducer: KafkaProducer,
    private readonly logger: Logger,
    private readonly metrics: DeliveryMetrics = { recordAgentOrder: () => {} },
    private readonly transaction: typeof withTransaction = withTransaction,
  ) {}

  // Called after PAYMENT_COMPLETED — creates one DeliveryGroup per agent
  async createGroupsForOrder(input: CreateDeliveryGroupsInput): Promise<void> {
    // Group items by agentId
    const byAgent = new Map<string, Array<{ productId: string; quantity: number; shippingFee: number }>>();
    for (const item of input.items) {
      if (!byAgent.has(item.agentId)) byAgent.set(item.agentId, []);
      byAgent.get(item.agentId)!.push({ productId: item.productId, quantity: item.quantity, shippingFee: item.shippingFee });
    }

    const groups = await this.transaction(async (client) => {
      const persisted: Array<{ id: string; agentId: string; shippingFee: number; created: boolean; items: Array<{ productId: string; quantity: number }> }> = [];
      for (const [agentId, agentItems] of byAgent.entries()) {
        const groupId = uuidv4();
        const shippingFee = agentItems.reduce((sum, item) => sum + item.shippingFee, 0);
        const { group, created } = await this.repo.createGroup(
          {
            id: groupId,
            orderId: input.orderId,
            userId: input.userId,
            paymentId: input.paymentId,
            agentId,
            status: DeliveryGroupStatus.PREPARING,
            shippingFee,
          },
          agentItems.map((i) => ({ deliveryGroupId: groupId, productId: i.productId, quantity: i.quantity })),
          client,
        );

        persisted.push({
          id: group.id,
          agentId,
          shippingFee: group.shippingFee,
          created,
          items: agentItems.map(({ productId, quantity }) => ({ productId, quantity })),
        });
      }
      return persisted;
    });

    // Publish after commit. Replayed ORDER_PAID events republish every persisted
    // group, repairing a prior Kafka failure without duplicating database rows.
    for (const group of groups) {
        if (group.created) this.metrics.recordAgentOrder(group.agentId);
        await this.kafkaProducer.send(
          KafkaTopic.DELIVERY_GROUP_CREATED,
          {
            topic: KafkaTopic.DELIVERY_GROUP_CREATED,
            payload: {
              deliveryGroupId: group.id,
              orderId: input.orderId,
              agentId: group.agentId,
              items: group.items,
              shippingFee: group.shippingFee,
            },
          },
          group.id,
        );
    }
  }

  // Agent marks shipment with tracking number
  async ship(deliveryGroupId: string, agentId: string | undefined, courierName: string, trackingNumber: string): Promise<void> {
    courierName = courierName?.trim();
    trackingNumber = trackingNumber?.trim();
    if (!courierName || courierName.length > 100 || !trackingNumber || trackingNumber.length > 100) {
      throw new BadRequestError('Courier name and tracking number must contain 1 to 100 characters');
    }
    const group = await this.repo.findById(deliveryGroupId);
    if (!group) throw new NotFoundError('DeliveryGroup', deliveryGroupId);
    if (agentId && group.agentId !== agentId) throw new ForbiddenError('You do not own this delivery group');
    if (group.status === DeliveryGroupStatus.SHIPPED
      && group.courierName === courierName && group.trackingNumber === trackingNumber && group.shippedAt) {
      await this.publishShipped(group, group.shippedAt);
      return;
    }
    if (group.status !== DeliveryGroupStatus.PREPARING) {
      throw new BadRequestError(`Cannot ship a delivery group in status: ${group.status}`);
    }

    const shippedAt = new Date();
    await this.repo.updateStatus(deliveryGroupId, DeliveryGroupStatus.SHIPPED, { courierName, trackingNumber, shippedAt });

    await this.publishShipped({ ...group, courierName, trackingNumber }, shippedAt);
  }

  private async publishShipped(group: { id: string; orderId: string; userId: string; agentId: string; courierName?: string; trackingNumber?: string }, shippedAt: Date): Promise<void> {
    const [shippedGroups, totalGroups] = await Promise.all([
      this.repo.countFulfillmentStarted(group.orderId),
      this.repo.countByOrder(group.orderId),
    ]);
    await this.kafkaProducer.send(
      KafkaTopic.DELIVERY_SHIPPED,
      {
        topic: KafkaTopic.DELIVERY_SHIPPED,
        payload: {
          deliveryGroupId: group.id,
          orderId: group.orderId,
          userId: group.userId,
          agentId: group.agentId,
          courierName: group.courierName!,
          trackingNumber: group.trackingNumber!,
          shippedAt: shippedAt.toISOString(),
          shippedGroups,
          totalGroups,
        },
      },
      group.id,
    );
  }

  // Mark as delivered — agent who owns the group, or admin/super-admin (webhook path)
  async markDelivered(deliveryGroupId: string, agentId?: string): Promise<void> {
    const group = await this.repo.findById(deliveryGroupId);
    if (!group) throw new NotFoundError('DeliveryGroup', deliveryGroupId);
    if (agentId && group.agentId !== agentId) throw new ForbiddenError('You do not own this delivery group');

    const deliveredAt = group.status === DeliveryGroupStatus.DELIVERED && group.deliveredAt ? group.deliveredAt : new Date();
    if (group.status !== DeliveryGroupStatus.DELIVERED) {
      if (![DeliveryGroupStatus.SHIPPED, DeliveryGroupStatus.IN_TRANSIT].includes(group.status)) {
        throw new BadRequestError(`Cannot deliver a group in status: ${group.status}`);
      }
      await this.repo.updateStatus(deliveryGroupId, DeliveryGroupStatus.DELIVERED, { deliveredAt });
    }

    await this.kafkaProducer.send(
      KafkaTopic.DELIVERY_DELIVERED,
      {
        topic: KafkaTopic.DELIVERY_DELIVERED,
        payload: { deliveryGroupId, orderId: group.orderId, userId: group.userId, deliveredAt: deliveredAt.toISOString() },
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
  async requestReturn(deliveryGroupId: string, userId: string, reason: string, refundAmount: number): Promise<void> {
    const group = await this.repo.findById(deliveryGroupId);
    if (!group) throw new NotFoundError('DeliveryGroup', deliveryGroupId);
    if (group.userId !== userId) throw new ForbiddenError('You do not own this delivery group');
    if (group.status === DeliveryGroupStatus.RETURN_REQUESTED) {
      const existing = await this.repo.findReturnByDeliveryGroup(deliveryGroupId);
      if (!existing || existing.userId !== userId || existing.reason !== reason || existing.refundAmount !== refundAmount) {
        throw new BadRequestError('A different return request already exists for this delivery group');
      }
      await this.publishReturnRequested(group, existing.id, userId, reason, refundAmount);
      return;
    }
    if (group.status !== DeliveryGroupStatus.DELIVERED) {
      throw new BadRequestError('Can only return delivered items');
    }

    const returnRequest = await withTransaction(async (client) => {
      const created = await this.repo.createReturnRequest({
        id: uuidv4(), deliveryGroupId, orderId: group.orderId, userId, reason, status: 'PENDING', refundAmount,
      }, client);
      await this.repo.updateStatus(deliveryGroupId, DeliveryGroupStatus.RETURN_REQUESTED, undefined, client);
      return created;
    });
    await this.publishReturnRequested(group, returnRequest.id, userId, reason, refundAmount);
  }

  async confirmDelivered(deliveryGroupId: string, userId: string): Promise<void> {
    const group = await this.repo.findById(deliveryGroupId);
    if (!group) throw new NotFoundError('DeliveryGroup', deliveryGroupId);
    if (group.userId !== userId) throw new ForbiddenError('You do not own this delivery group');
    await this.markDelivered(deliveryGroupId);
  }

  async updateStatusByAdmin(deliveryGroupId: string, status: DeliveryGroupStatus): Promise<void> {
    const group = await this.repo.findById(deliveryGroupId);
    if (!group) throw new NotFoundError('DeliveryGroup', deliveryGroupId);
    if (group.status === status) {
      if (status === DeliveryGroupStatus.DELIVERED) await this.markDelivered(deliveryGroupId);
      return;
    }
    const transitions: Partial<Record<DeliveryGroupStatus, DeliveryGroupStatus[]>> = {
      [DeliveryGroupStatus.PREPARING]: [DeliveryGroupStatus.FAILED, DeliveryGroupStatus.CANCELLED],
      [DeliveryGroupStatus.SHIPPED]: [DeliveryGroupStatus.IN_TRANSIT, DeliveryGroupStatus.DELIVERED, DeliveryGroupStatus.FAILED],
      [DeliveryGroupStatus.IN_TRANSIT]: [DeliveryGroupStatus.DELIVERED, DeliveryGroupStatus.FAILED],
      [DeliveryGroupStatus.FAILED]: [DeliveryGroupStatus.PREPARING, DeliveryGroupStatus.CANCELLED],
    };
    if (!transitions[group.status]?.includes(status)) {
      throw new BadRequestError(`Cannot change delivery status from ${group.status} to ${status}`);
    }
    if (status === DeliveryGroupStatus.DELIVERED) {
      await this.markDelivered(deliveryGroupId);
    } else {
      await this.repo.updateStatus(deliveryGroupId, status);
    }
  }

  async cancelPreparingGroups(orderId: string): Promise<number> {
    return this.repo.cancelPreparingByOrder(orderId);
  }

  private async publishReturnRequested(group: { id: string; orderId: string; paymentId: string; agentId: string }, returnRequestId: string, userId: string, reason: string, refundAmount: number): Promise<void> {
    await this.kafkaProducer.send(
      KafkaTopic.RETURN_REQUESTED,
      {
        topic: KafkaTopic.RETURN_REQUESTED,
        payload: {
          returnRequestId,
          deliveryGroupId: group.id,
          orderId: group.orderId,
          paymentId: group.paymentId,
          agentId: group.agentId,
          userId,
          refundAmount,
          reason,
        },
      },
      group.id,
    );
  }

  async completeReturn(returnRequestId: string, refundAmount: number): Promise<void> {
    const request = await this.repo.findReturnById(returnRequestId);
    if (!request) throw new NotFoundError('ReturnRequest', returnRequestId);
    if (request.refundAmount !== refundAmount) throw new BadRequestError('Refund amount does not match the return request');
    const group = await this.repo.findById(request.deliveryGroupId);
    if (!group) throw new NotFoundError('DeliveryGroup', request.deliveryGroupId);

    const completedAt = group.returnedAt ?? new Date();
    if (request.status !== 'COMPLETED' || group.status !== DeliveryGroupStatus.RETURNED) {
      if (request.status !== 'PENDING' || group.status !== DeliveryGroupStatus.RETURN_REQUESTED) {
        throw new BadRequestError('Return is not awaiting refund completion');
      }
      await withTransaction(async (client) => {
        await this.repo.updateReturnStatus(request.id, 'COMPLETED', refundAmount, client);
        await this.repo.updateStatus(group.id, DeliveryGroupStatus.RETURNED, { returnedAt: completedAt }, client);
      });
    }

    await this.kafkaProducer.send(KafkaTopic.RETURN_COMPLETED, {
      topic: KafkaTopic.RETURN_COMPLETED,
      payload: {
        returnRequestId: request.id,
        deliveryGroupId: group.id,
        orderId: group.orderId,
        userId: request.userId,
        refundAmount,
        completedAt: completedAt.toISOString(),
      },
    }, request.id);
  }

  async getGroupsByOrder(orderId: string): Promise<ReturnType<DeliveryRepository['findByOrderId']>> {
    return this.repo.findByOrderId(orderId);
  }

  async getAgentGroups(agentId: string, page: number, limit: number, status?: DeliveryGroupStatus) {
    const offset = (page - 1) * limit;
    return this.repo.findByAgent(agentId, limit, offset, status);
  }
}

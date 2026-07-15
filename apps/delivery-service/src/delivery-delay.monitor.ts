import { KafkaProducer } from '@ecommerce/kafka-client';
import { Logger } from '@ecommerce/logger';
import { KafkaTopic } from '@ecommerce/shared';
import { DeliveryRepository } from './domain/repositories/delivery.repository';

export class DeliveryDelayMonitor {
  constructor(
    private readonly repository: Pick<DeliveryRepository, 'findOverduePreparing' | 'markDelayAlerted'>,
    private readonly producer: Pick<KafkaProducer, 'send'>,
    private readonly thresholdHours: number,
    private readonly batchSize: number,
    private readonly logger?: Logger,
  ) {
    if (!Number.isInteger(thresholdHours) || thresholdHours <= 0) throw new Error('Delivery delay threshold must be a positive integer');
    if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error('Delivery delay batch size must be a positive integer');
  }

  async scan(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.thresholdHours * 60 * 60 * 1000);
    const groups = await this.repository.findOverduePreparing(cutoff, this.batchSize);
    for (const group of groups) {
      await this.producer.send(KafkaTopic.DELIVERY_DELAYED, {
        topic: KafkaTopic.DELIVERY_DELAYED,
        payload: {
          deliveryGroupId: group.id,
          orderId: group.orderId,
          agentId: group.agentId,
          delayedSince: group.createdAt.toISOString(),
          thresholdHours: this.thresholdHours,
        },
      }, group.id, group.id);
      await this.repository.markDelayAlerted(group.id);
    }
    if (groups.length > 0) this.logger?.warn({ count: groups.length, cutoff }, 'Published delayed delivery warnings');
    return groups.length;
  }
}

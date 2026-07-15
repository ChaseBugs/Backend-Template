import { KafkaProducer } from '@ecommerce/kafka-client';
import { BadRequestError, NotFoundError } from '@ecommerce/errors';
import { KafkaTopic, OrderStatus } from '@ecommerce/shared';
import { OrderRepository } from '../../domain/repositories/order.repository';

export class AdminUpdateOrderStatusUseCase {
  constructor(private readonly repo: OrderRepository, private readonly producer: KafkaProducer) {}

  async execute(orderId: string, status: OrderStatus, changedBy: string): Promise<{ previousStatus: OrderStatus; status: OrderStatus }> {
    const order = await this.repo.findById(orderId);
    if (!order) throw new NotFoundError('Order', orderId);
    if (!Object.values(OrderStatus).includes(status)) throw new BadRequestError('Invalid order status');

    const previousStatus = order.status;
    if (previousStatus !== status) await this.repo.updateStatus(orderId, status);

    await this.producer.send(KafkaTopic.ORDER_STATUS_CHANGED, {
      topic: KafkaTopic.ORDER_STATUS_CHANGED,
      payload: { orderId, previousStatus, status, changedBy },
    }, orderId);
    return { previousStatus, status };
  }
}

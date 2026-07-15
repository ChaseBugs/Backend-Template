import { KafkaProducer } from '@ecommerce/kafka-client';
import { BadRequestError, ForbiddenError, NotFoundError } from '@ecommerce/errors';
import { KafkaTopic, OrderStatus } from '@ecommerce/shared';
import { OrderRepository } from '../../domain/repositories/order.repository';

interface Actor { id: string; role: string }

export class CancelOrderUseCase {
  constructor(private readonly repo: OrderRepository, private readonly producer: KafkaProducer) {}

  async execute(orderId: string, actor: Actor, reason: string): Promise<void> {
    const order = await this.repo.findById(orderId);
    if (!order) throw new NotFoundError('Order', orderId);

    const isAdmin = actor.role === 'admin' || actor.role === 'super-admin';
    if (!isAdmin && (actor.role !== 'user' || order.userId !== actor.id)) {
      throw new ForbiddenError('Only the order owner or an admin can cancel this order');
    }

    if (order.status === OrderStatus.CANCELLED) {
      if (order.cancelReason && order.cancelReason !== reason) {
        throw new BadRequestError('Order was already cancelled for a different reason');
      }
      await this.publishCancelled(order);
      return;
    }

    if (![OrderStatus.PENDING, OrderStatus.PAYMENT_PENDING].includes(order.status)) {
      throw new BadRequestError(`Cannot cancel an order in status: ${order.status}`);
    }

    await this.repo.updateStatus(orderId, OrderStatus.CANCELLED, { cancelReason: reason });
    await this.publishCancelled(order);
  }

  private async publishCancelled(order: { id: string; sagaId: string; items: Array<{ productId: string; quantity: number }> }): Promise<void> {
    await this.producer.send(
      KafkaTopic.ORDER_CANCELLED,
      { topic: KafkaTopic.ORDER_CANCELLED, payload: { orderId: order.id, sagaId: order.sagaId, items: order.items } },
      order.sagaId,
    );
  }
}

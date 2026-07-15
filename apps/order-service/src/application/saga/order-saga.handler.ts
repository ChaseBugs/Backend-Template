import { OrderRepository } from '../../domain/repositories/order.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { OrderStatus, KafkaTopic } from '@ecommerce/shared';
import { Logger } from '@ecommerce/logger';

// Handles Kafka events to advance/compensate the order SAGA

export class OrderSagaHandler {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly kafkaProducer: KafkaProducer,
    private readonly logger: Logger,
  ) {}

  // Step 2: Inventory reserved → trigger payment
  async onInventoryReserved(event: { orderId: string; sagaId: string; items: unknown[] }): Promise<void> {
    const saga = await this.orderRepo.getSaga(event.sagaId);
    if (!saga || !['STARTED', 'INVENTORY_RESERVED'].includes(saga.status)) return;

    if (saga.status === 'STARTED') {
      await this.orderRepo.updateSaga(event.sagaId, 'INVENTORY_RESERVED');
      await this.orderRepo.updateStatus(event.orderId, OrderStatus.PAYMENT_PENDING);
    }

    // Notify payment-service to initiate payment
    await this.kafkaProducer.send(
      KafkaTopic.ORDER_CONFIRMED,
      {
        topic: KafkaTopic.ORDER_CONFIRMED,
        payload: { orderId: event.orderId, sagaId: event.sagaId },
      },
      event.sagaId,
    );
  }

  // Step 3a: Payment completed → order PAID, create delivery groups
  async onPaymentCompleted(event: { paymentId: string; orderId: string; sagaId: string; amount: number }): Promise<void> {
    const saga = await this.orderRepo.getSaga(event.sagaId);
    if (!saga || !['INVENTORY_RESERVED', 'COMPLETED'].includes(saga.status)) return;
    const order = await this.orderRepo.findById(event.orderId);
    if (!order) return;

    if (saga.status === 'INVENTORY_RESERVED') {
      await this.orderRepo.updateSaga(event.sagaId, 'COMPLETED');
      await this.orderRepo.updateStatus(event.orderId, OrderStatus.PAID, { paymentId: event.paymentId });
    }

    // Delivery-service listens to ORDER_PAID (order.events) to create DeliveryGroups —
    // PAYMENT_COMPLETED (payment.events) never carries line items, only order-service has them.
    await this.kafkaProducer.send(
      KafkaTopic.ORDER_PAID,
      {
        topic: KafkaTopic.ORDER_PAID,
        payload: {
          orderId: event.orderId,
          userId: order.userId,
          paymentId: event.paymentId,
          items: saga.items,
        },
      },
      event.sagaId,
    );

    this.logger.info({ orderId: event.orderId }, 'Order payment completed');
  }

  // Step 3b: Payment failed → compensate (release inventory)
  async onPaymentFailed(event: { orderId: string; sagaId: string; reason: string }): Promise<void> {
    const saga = await this.orderRepo.getSaga(event.sagaId);
    if (!saga || !['STARTED', 'INVENTORY_RESERVED', 'COMPENSATION_STARTED'].includes(saga.status)) return;

    if (saga.status !== 'COMPENSATION_STARTED') {
      await this.orderRepo.updateSaga(event.sagaId, 'COMPENSATION_STARTED', event.reason);
      await this.orderRepo.updateStatus(event.orderId, OrderStatus.CANCELLED, { cancelReason: event.reason });
    }

    // Release inventory reservation
    await this.kafkaProducer.send(
      KafkaTopic.ORDER_CANCELLED,
      {
        topic: KafkaTopic.ORDER_CANCELLED,
        payload: { orderId: event.orderId, sagaId: event.sagaId, items: saga.items },
      },
      event.sagaId,
    );
  }

  // Step 3c: Inventory reservation failed → cancel order
  async onInventoryReservationFailed(event: { orderId: string; sagaId: string; reason: string }): Promise<void> {
    const saga = await this.orderRepo.getSaga(event.sagaId);
    if (!saga) return;

    if (saga.status !== 'FAILED') {
      await this.orderRepo.updateSaga(event.sagaId, 'FAILED', event.reason);
      await this.orderRepo.updateStatus(event.orderId, OrderStatus.CANCELLED, { cancelReason: event.reason });
    }
    await this.kafkaProducer.send(
      KafkaTopic.ORDER_CANCELLED,
      { topic: KafkaTopic.ORDER_CANCELLED, payload: { orderId: event.orderId, sagaId: event.sagaId, items: saga.items } },
      event.sagaId,
    );
  }

  // All deliveries completed → order COMPLETED
  async onAllDeliveriesCompleted(event: { orderId: string }): Promise<void> {
    const order = await this.orderRepo.findById(event.orderId);
    if (!order || [OrderStatus.CANCELLED, OrderStatus.REFUNDED].includes(order.status)) return;
    if (order.status !== OrderStatus.COMPLETED) await this.orderRepo.updateStatus(event.orderId, OrderStatus.COMPLETED);
    await this.kafkaProducer.send(
      KafkaTopic.ORDER_COMPLETED,
      { topic: KafkaTopic.ORDER_COMPLETED, payload: { orderId: event.orderId } },
      event.orderId,
    );
  }

  async onDeliveryShipped(event: { orderId: string; deliveryGroupId: string; shippedGroups: number; totalGroups: number }): Promise<void> {
    if (!Number.isInteger(event.shippedGroups) || !Number.isInteger(event.totalGroups)
      || event.shippedGroups <= 0 || event.totalGroups <= 0 || event.shippedGroups > event.totalGroups) return;
    const order = await this.orderRepo.findById(event.orderId);
    if (!order || [OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.REFUNDED].includes(order.status)) return;
    const desired = event.shippedGroups === event.totalGroups ? OrderStatus.SHIPPED : OrderStatus.PARTIALLY_SHIPPED;
    // Delivery event retries can arrive after a newer group event; never regress.
    if (order.status === OrderStatus.SHIPPED && desired === OrderStatus.PARTIALLY_SHIPPED) return;
    if (order.status !== desired) await this.orderRepo.updateStatus(order.id, desired);
    await this.kafkaProducer.send(KafkaTopic.ORDER_STATUS_CHANGED, {
      topic: KafkaTopic.ORDER_STATUS_CHANGED,
      payload: {
        orderId: order.id,
        previousStatus: order.status,
        status: desired,
        changedBy: `delivery:${event.deliveryGroupId}`,
      },
    }, event.deliveryGroupId);
  }

  // A partial seller refund leaves the order active. Only the cumulative full
  // payment refund transitions the authoritative order and its read model.
  async onPaymentRefunded(event: { paymentId: string; orderId: string; refundId: string; paymentStatus: string }): Promise<void> {
    if (event.paymentStatus !== 'REFUNDED') return;
    const order = await this.orderRepo.findById(event.orderId);
    if (!order || (order.paymentId && order.paymentId !== event.paymentId)) return;
    if (order.status === OrderStatus.CANCELLED) return;

    const previousStatus = order.status;
    if (order.status !== OrderStatus.REFUNDED) {
      await this.orderRepo.updateStatus(order.id, OrderStatus.REFUNDED);
    }
    await this.kafkaProducer.send(
      KafkaTopic.ORDER_STATUS_CHANGED,
      {
        topic: KafkaTopic.ORDER_STATUS_CHANGED,
        payload: {
          orderId: order.id,
          previousStatus,
          status: OrderStatus.REFUNDED,
          changedBy: `refund:${event.refundId}`,
        },
      },
      event.refundId,
    );
  }
}

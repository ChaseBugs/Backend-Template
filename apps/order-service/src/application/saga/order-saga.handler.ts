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
    if (!saga || saga.status !== 'STARTED') return;

    await this.orderRepo.updateSaga(event.sagaId, 'INVENTORY_RESERVED');
    await this.orderRepo.updateStatus(event.orderId, OrderStatus.PAYMENT_PENDING);

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
    if (!saga) return;

    await this.orderRepo.updateSaga(event.sagaId, 'COMPLETED');
    await this.orderRepo.updateStatus(event.orderId, OrderStatus.PAID, { paymentId: event.paymentId });

    // Delivery-service listens to PAYMENT_COMPLETED to create DeliveryGroups
    this.logger.info({ orderId: event.orderId }, 'Order payment completed');
  }

  // Step 3b: Payment failed → compensate (release inventory)
  async onPaymentFailed(event: { orderId: string; sagaId: string; reason: string }): Promise<void> {
    const saga = await this.orderRepo.getSaga(event.sagaId);
    if (!saga) return;

    await this.orderRepo.updateSaga(event.sagaId, 'COMPENSATION_STARTED', event.reason);
    await this.orderRepo.updateStatus(event.orderId, OrderStatus.CANCELLED, { cancelReason: event.reason });

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

    await this.orderRepo.updateSaga(event.sagaId, 'FAILED', event.reason);
    await this.orderRepo.updateStatus(event.orderId, OrderStatus.CANCELLED, { cancelReason: event.reason });
  }

  // All deliveries completed → order COMPLETED
  async onAllDeliveriesCompleted(event: { orderId: string }): Promise<void> {
    await this.orderRepo.updateStatus(event.orderId, OrderStatus.COMPLETED);
    await this.kafkaProducer.send(
      KafkaTopic.ORDER_COMPLETED,
      { topic: KafkaTopic.ORDER_COMPLETED, payload: { orderId: event.orderId } },
      event.orderId,
    );
  }
}

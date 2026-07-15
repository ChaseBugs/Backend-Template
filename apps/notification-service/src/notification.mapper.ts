import { KafkaTopic } from '@ecommerce/shared';

export interface NotificationDraft {
  userId?: string;
  agentId?: string;
  recipientRoles?: Array<'admin' | 'super-admin'>;
  type: string;
  title: string;
  body: string;
  routingKey: string;
  metadata: Record<string, unknown>;
}

export function mapEventToNotification(topic: string, payload: any): NotificationDraft | null {
  switch (topic) {
    case KafkaTopic.SYSTEM_WARNING:
      return { recipientRoles: ['admin', 'super-admin'], type: 'SYSTEM_WARNING', title: 'System health warning', body: payload.message, routingKey: 'system.warning', metadata: { source: payload.source, code: payload.code, targetUrl: payload.targetUrl, consecutiveFailures: payload.consecutiveFailures, detectedAt: payload.detectedAt } };
    case KafkaTopic.AGENT_APPLICATION_SUBMITTED:
      return { recipientRoles: ['admin', 'super-admin'], type: 'AGENT_APPLICATION_SUBMITTED', title: 'New agent application', body: `${payload.businessName} submitted an agent application.`, routingKey: 'agent.application_submitted', metadata: { agentId: payload.agentId, userId: payload.userId, businessName: payload.businessName, businessNumber: payload.businessNumber } };
    case KafkaTopic.ORDER_CREATED:
      return { userId: payload.userId, type: 'ORDER_CREATED', title: 'Order received', body: `Order #${payload.orderId.slice(0, 8)} has been received.`, routingKey: 'order.created', metadata: { orderId: payload.orderId } };
    case KafkaTopic.PAYMENT_COMPLETED:
      return { userId: payload.userId, type: 'PAYMENT_COMPLETED', title: 'Payment completed', body: `Payment of ${Number(payload.amount).toLocaleString()} KRW completed.`, routingKey: 'payment.completed', metadata: { orderId: payload.orderId, paymentId: payload.paymentId, amount: payload.amount } };
    case KafkaTopic.PAYMENT_FAILED:
      return { userId: payload.userId, type: 'PAYMENT_FAILED', title: 'Payment failed', body: `Payment failed: ${payload.reason}`, routingKey: 'payment.failed', metadata: { orderId: payload.orderId, paymentId: payload.paymentId, reason: payload.reason } };
    case KafkaTopic.DELIVERY_GROUP_CREATED:
      return { agentId: payload.agentId, type: 'DELIVERY_GROUP_CREATED', title: 'New order to fulfill', body: 'A paid order is ready for shipment.', routingKey: 'delivery.group_created', metadata: { orderId: payload.orderId, deliveryGroupId: payload.deliveryGroupId } };
    case KafkaTopic.DELIVERY_DELAYED:
      return { recipientRoles: ['admin', 'super-admin'], type: 'DELIVERY_DELAYED', title: 'Delivery delay warning', body: `Delivery group for order #${payload.orderId.slice(0, 8)} is still awaiting shipment.`, routingKey: 'delivery.delayed', metadata: { orderId: payload.orderId, deliveryGroupId: payload.deliveryGroupId, agentId: payload.agentId, delayedSince: payload.delayedSince, thresholdHours: payload.thresholdHours } };
    case KafkaTopic.DELIVERY_SHIPPED:
      return { userId: payload.userId, type: 'DELIVERY_SHIPPED', title: 'Order shipped', body: `Tracking: ${payload.trackingNumber} (${payload.courierName})`, routingKey: 'delivery.shipped', metadata: { orderId: payload.orderId, deliveryGroupId: payload.deliveryGroupId, trackingNumber: payload.trackingNumber } };
    case KafkaTopic.DELIVERY_DELIVERED:
      return { userId: payload.userId, type: 'DELIVERY_DELIVERED', title: 'Delivery completed', body: 'Your order has been delivered.', routingKey: 'delivery.delivered', metadata: { orderId: payload.orderId, deliveryGroupId: payload.deliveryGroupId } };
    case KafkaTopic.RETURN_REQUESTED:
      return { agentId: payload.agentId, type: 'RETURN_REQUESTED', title: 'Return requested', body: `A return was requested: ${payload.reason}`, routingKey: 'delivery.return_requested', metadata: { orderId: payload.orderId, deliveryGroupId: payload.deliveryGroupId, returnRequestId: payload.returnRequestId } };
    case KafkaTopic.RETURN_COMPLETED:
      return { userId: payload.userId, type: 'RETURN_COMPLETED', title: 'Return completed', body: `Your refund of ${Number(payload.refundAmount).toLocaleString()} KRW has been completed.`, routingKey: 'delivery.return_completed', metadata: { orderId: payload.orderId, deliveryGroupId: payload.deliveryGroupId, returnRequestId: payload.returnRequestId, refundAmount: payload.refundAmount } };
    case KafkaTopic.AGENT_APPROVED:
      return { userId: payload.userId, type: 'AGENT_APPROVED', title: 'Agent approved', body: 'Your seller account has been approved.', routingKey: 'agent.approved', metadata: { agentId: payload.agentId } };
    case KafkaTopic.AGENT_REJECTED:
      return { userId: payload.userId, type: 'AGENT_REJECTED', title: 'Agent application rejected', body: `Your application was rejected: ${payload.reason}`, routingKey: 'agent.rejected', metadata: { agentId: payload.agentId, reason: payload.reason } };
    case KafkaTopic.AGENT_SETTLEMENT_CREATED:
      return { agentId: payload.agentId, type: 'AGENT_SETTLEMENT_CREATED', title: 'Settlement created', body: `A settlement of ${Number(payload.netAmount).toLocaleString()} KRW is pending.`, routingKey: 'payment.settlement', metadata: { orderId: payload.orderId, paymentId: payload.paymentId, settlementId: payload.settlementId } };
    case KafkaTopic.AGENT_SETTLEMENT_COMPLETED:
      return { agentId: payload.agentId, type: 'AGENT_SETTLEMENT_COMPLETED', title: 'Settlement completed', body: `Your settlement of ${Number(payload.netAmount).toLocaleString()} KRW has been completed.`, routingKey: 'payment.settlement', metadata: { orderId: payload.orderId, paymentId: payload.paymentId, settlementId: payload.settlementId, completedAt: payload.completedAt } };
    case KafkaTopic.STOCK_LOW:
      return { agentId: payload.agentId, type: 'STOCK_LOW', title: 'Low stock warning', body: `Product stock is low (${payload.available} remaining).`, routingKey: 'inventory.stock_low', metadata: { productId: payload.productId, available: payload.available, threshold: payload.threshold } };
    case KafkaTopic.PRODUCT_APPROVED:
      return { agentId: payload.agentId, type: 'PRODUCT_APPROVED', title: 'Product approved', body: 'Your product has been approved and published.', routingKey: 'agent.product_approved', metadata: { productId: payload.productId } };
    case KafkaTopic.PRODUCT_REJECTED:
      return { agentId: payload.agentId, type: 'PRODUCT_REJECTED', title: 'Product rejected', body: `Your product was rejected: ${payload.reason}`, routingKey: 'agent.product_rejected', metadata: { productId: payload.productId, reason: payload.reason } };
    default:
      return null;
  }
}

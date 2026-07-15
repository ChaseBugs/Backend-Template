export const KafkaTopic = {
  // Auth events
  USER_REGISTERED: 'user.registered',
  USER_ROLE_CHANGED: 'user.role.changed',
  USER_STATUS_CHANGED: 'user.status.changed',
  AGENT_APPLICATION_SUBMITTED: 'agent.application.submitted',
  AGENT_APPROVED: 'agent.approved',
  AGENT_REJECTED: 'agent.rejected',

  // Product events
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
  PRODUCT_APPROVED: 'product.approved',
  PRODUCT_REJECTED: 'product.rejected',

  // Inventory events
  INVENTORY_RESERVED: 'inventory.reserved',
  INVENTORY_RESERVATION_FAILED: 'inventory.reservation.failed',
  INVENTORY_RELEASED: 'inventory.released',
  INVENTORY_DEDUCTED: 'inventory.deducted',
  INVENTORY_UPDATED: 'inventory.updated',
  STOCK_LOW: 'stock.low',

  // Order events
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_PAID: 'order.paid',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_COMPLETED: 'order.completed',
  ORDER_STATUS_CHANGED: 'order.status.changed',

  // Payment events
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  AGENT_SETTLEMENT_CREATED: 'payment.agent-settlement.created',
  AGENT_SETTLEMENT_COMPLETED: 'payment.agent-settlement.completed',

  // Delivery events
  DELIVERY_GROUP_CREATED: 'delivery.group.created',
  DELIVERY_DELAYED: 'delivery.delayed',
  DELIVERY_SHIPPED: 'delivery.shipped',
  DELIVERY_DELIVERED: 'delivery.delivered',
  ALL_DELIVERIES_COMPLETED: 'delivery.all.completed',
  RETURN_REQUESTED: 'delivery.return.requested',
  RETURN_COMPLETED: 'delivery.return.completed',

  // Review events
  REVIEW_RATING_UPDATED: 'review.rating.updated',

  // Operations events
  SYSTEM_WARNING: 'system.warning',
} as const;

export type KafkaTopicValue = (typeof KafkaTopic)[keyof typeof KafkaTopic];

export interface BaseEvent {
  eventId: string;
  occurredAt: string; // ISO 8601
  version: number;
}

export interface UserRegisteredEvent extends BaseEvent {
  topic: typeof KafkaTopic.USER_REGISTERED;
  payload: {
    userId: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
  };
}

export interface AgentApprovedEvent extends BaseEvent {
  topic: typeof KafkaTopic.AGENT_APPROVED;
  payload: {
    agentId: string;
    userId: string;
    businessName: string;
    approvedBy: string;
  };
}

export interface SystemWarningEvent extends BaseEvent {
  topic: typeof KafkaTopic.SYSTEM_WARNING;
  payload: {
    source: string;
    code: 'SERVICE_UNREADY';
    message: string;
    targetUrl: string;
    consecutiveFailures: number;
    detectedAt: string;
  };
}

export interface AgentApplicationSubmittedEvent extends BaseEvent {
  topic: typeof KafkaTopic.AGENT_APPLICATION_SUBMITTED;
  payload: {
    agentId: string;
    userId: string;
    businessName: string;
    businessNumber: string;
  };
}

export interface AgentRejectedEvent extends BaseEvent {
  topic: typeof KafkaTopic.AGENT_REJECTED;
  payload: { agentId: string; userId: string; reason: string };
}

export interface ProductCreatedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PRODUCT_CREATED;
  payload: {
    productId: string;
    catalogVariantId: string;
    agentId: string;
    sku: string;
    condition: string;
    name: string;
    description: string;
    price: number;
    comparePrice?: number;
    categoryId: string;
    brand?: string;
    tags: string[];
    images: string[];
    initialStock: number;
  };
}

export interface ProductUpdatedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PRODUCT_UPDATED;
  payload: {
    productId: string;
    agentId: string;
    changes: Record<string, unknown>;
  };
}

export interface ProductDeletedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PRODUCT_DELETED;
  payload: { productId: string; agentId: string };
}

export interface ProductRejectedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PRODUCT_REJECTED;
  payload: { productId: string; agentId: string; approvedBy: string; reason: string };
}

export interface InventoryReservedEvent extends BaseEvent {
  topic: typeof KafkaTopic.INVENTORY_RESERVED;
  payload: {
    orderId: string;
    sagaId: string;
    items: Array<{ productId: string; quantity: number }>;
  };
}

export interface InventoryReservationFailedEvent extends BaseEvent {
  topic: typeof KafkaTopic.INVENTORY_RESERVATION_FAILED;
  payload: {
    orderId: string;
    sagaId: string;
    reason: string;
    failedProductId?: string;
  };
}

export interface InventoryReleasedEvent extends BaseEvent {
  topic: typeof KafkaTopic.INVENTORY_RELEASED;
  payload: {
    orderId: string;
    sagaId: string;
    items: Array<{ productId: string; quantity: number }>;
  };
}

export interface OrderCreatedEvent extends BaseEvent {
  topic: typeof KafkaTopic.ORDER_CREATED;
  payload: {
    orderId: string;
    sagaId: string;
    userId: string;
    items: Array<{ productId: string; agentId: string; quantity: number; unitPrice: number; discountAmount: number; shippingFee: number }>;
    totalAmount: number;
    shippingFee: number;
    discountAmount: number;
    finalAmount: number;
    shippingAddress: {
      recipientName: string;
      phone: string;
      addressLine1: string;
      addressLine2?: string;
      city: string;
      postalCode: string;
    };
  };
}

export interface OrderPaidEvent extends BaseEvent {
  topic: typeof KafkaTopic.ORDER_PAID;
  payload: {
    orderId: string;
    userId: string;
    paymentId: string;
    items: Array<{ productId: string; agentId: string; quantity: number; unitPrice: number; discountAmount: number; shippingFee: number }>;
  };
}

export interface PaymentCompletedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PAYMENT_COMPLETED;
  payload: {
    paymentId: string;
    orderId: string;
    userId: string;
    sagaId: string;
    amount: number;
    method: string;
    transactionId: string;
  };
}

export interface PaymentFailedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PAYMENT_FAILED;
  payload: {
    paymentId: string;
    orderId: string;
    userId: string;
    sagaId: string;
    reason: string;
  };
}

export interface PaymentRefundedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PAYMENT_REFUNDED;
  payload: {
    paymentId: string;
    orderId: string;
    refundId: string;
    referenceId: string;
    agentId?: string;
    refundAmount: number;
    totalRefunded: number;
    paymentStatus: string;
    reason: string;
  };
}

export interface OrderStatusChangedEvent extends BaseEvent {
  topic: typeof KafkaTopic.ORDER_STATUS_CHANGED;
  payload: {
    orderId: string;
    previousStatus: string;
    status: string;
    changedBy: string;
  };
}

export interface UserRoleChangedEvent extends BaseEvent {
  topic: typeof KafkaTopic.USER_ROLE_CHANGED;
  payload: {
    userId: string;
    role: string;
    changedBy: string;
  };
}

export interface UserStatusChangedEvent extends BaseEvent {
  topic: typeof KafkaTopic.USER_STATUS_CHANGED;
  payload: { userId: string; isActive: boolean };
}

export interface InventoryUpdatedEvent extends BaseEvent {
  topic: typeof KafkaTopic.INVENTORY_UPDATED;
  payload: {
    productId: string;
    agentId: string;
    available: number;
    reserved: number;
  };
}

export interface InventoryDeductedEvent extends BaseEvent {
  topic: typeof KafkaTopic.INVENTORY_DEDUCTED;
  payload: { orderId: string; items: Array<{ productId: string; quantity: number; available: number }> };
}

export interface StockLowEvent extends BaseEvent {
  topic: typeof KafkaTopic.STOCK_LOW;
  payload: { productId: string; agentId: string; available: number; threshold: number };
}

export interface OrderConfirmedEvent extends BaseEvent {
  topic: typeof KafkaTopic.ORDER_CONFIRMED;
  payload: { orderId: string; sagaId: string };
}

export interface OrderCancelledEvent extends BaseEvent {
  topic: typeof KafkaTopic.ORDER_CANCELLED;
  payload: { orderId: string; sagaId: string; items: Array<{ productId: string; quantity: number }> };
}

export interface OrderCompletedEvent extends BaseEvent {
  topic: typeof KafkaTopic.ORDER_COMPLETED;
  payload: { orderId: string };
}

export interface ProductApprovedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PRODUCT_APPROVED;
  payload: {
    productId: string;
    catalogVariantId: string;
    agentId: string;
    sku: string;
    condition: string;
    name: string;
    description: string;
    price: number;
    comparePrice?: number;
    categoryId: string;
    brand?: string;
    tags: string[];
    images: string[];
    approvedBy: string;
  };
}

export interface ReviewRatingUpdatedEvent extends BaseEvent {
  topic: typeof KafkaTopic.REVIEW_RATING_UPDATED;
  payload: {
    productId: string;
    average: number;
    count: number;
  };
}

export interface AgentSettlementCreatedEvent extends BaseEvent {
  topic: typeof KafkaTopic.AGENT_SETTLEMENT_CREATED;
  payload: {
    settlementId: string;
    paymentId: string;
    orderId: string;
    agentId: string;
    grossAmount: number;
    commissionRate: number;
    commissionAmount: number;
    netAmount: number;
  };
}

export interface AgentSettlementCompletedEvent extends BaseEvent {
  topic: typeof KafkaTopic.AGENT_SETTLEMENT_COMPLETED;
  payload: {
    settlementId: string;
    paymentId: string;
    orderId: string;
    agentId: string;
    netAmount: number;
    completedAt: string;
  };
}

export interface ReturnCompletedEvent extends BaseEvent {
  topic: typeof KafkaTopic.RETURN_COMPLETED;
  payload: {
    returnRequestId: string;
    deliveryGroupId: string;
    orderId: string;
    userId: string;
    refundAmount: number;
    completedAt: string;
  };
}

export interface DeliveryGroupCreatedEvent extends BaseEvent {
  topic: typeof KafkaTopic.DELIVERY_GROUP_CREATED;
  payload: {
    deliveryGroupId: string;
    orderId: string;
    agentId: string;
    items: Array<{ productId: string; quantity: number }>;
    shippingFee: number;
  };
}

export interface DeliveryDelayedEvent extends BaseEvent {
  topic: typeof KafkaTopic.DELIVERY_DELAYED;
  payload: {
    deliveryGroupId: string;
    orderId: string;
    agentId: string;
    delayedSince: string;
    thresholdHours: number;
  };
}

export interface DeliveryShippedEvent extends BaseEvent {
  topic: typeof KafkaTopic.DELIVERY_SHIPPED;
  payload: {
    deliveryGroupId: string;
    orderId: string;
    userId: string;
    agentId: string;
    courierName: string;
    trackingNumber: string;
    shippedAt: string;
    shippedGroups: number;
    totalGroups: number;
  };
}

export interface DeliveryDeliveredEvent extends BaseEvent {
  topic: typeof KafkaTopic.DELIVERY_DELIVERED;
  payload: {
    deliveryGroupId: string;
    orderId: string;
    userId: string;
    deliveredAt: string;
  };
}

export interface AllDeliveriesCompletedEvent extends BaseEvent {
  topic: typeof KafkaTopic.ALL_DELIVERIES_COMPLETED;
  payload: {
    orderId: string;
    completedAt: string;
  };
}

export interface ReturnRequestedEvent extends BaseEvent {
  topic: typeof KafkaTopic.RETURN_REQUESTED;
  payload: {
    returnRequestId: string;
    deliveryGroupId: string;
    orderId: string;
    paymentId: string;
    agentId: string;
    userId: string;
    refundAmount: number;
    reason: string;
  };
}

export type KafkaEvent =
  | UserRegisteredEvent
  | SystemWarningEvent
  | AgentApplicationSubmittedEvent
  | UserRoleChangedEvent
  | UserStatusChangedEvent
  | AgentApprovedEvent
  | AgentRejectedEvent
  | ProductCreatedEvent
  | ProductUpdatedEvent
  | ProductDeletedEvent
  | ProductApprovedEvent
  | ProductRejectedEvent
  | ReviewRatingUpdatedEvent
  | OrderPaidEvent
  | OrderStatusChangedEvent
  | InventoryReservedEvent
  | InventoryReservationFailedEvent
  | InventoryReleasedEvent
  | InventoryUpdatedEvent
  | InventoryDeductedEvent
  | StockLowEvent
  | OrderCreatedEvent
  | OrderConfirmedEvent
  | OrderCancelledEvent
  | OrderCompletedEvent
  | PaymentCompletedEvent
  | PaymentFailedEvent
  | PaymentRefundedEvent
  | ReturnCompletedEvent
  | AgentSettlementCreatedEvent
  | AgentSettlementCompletedEvent
  | DeliveryGroupCreatedEvent
  | DeliveryDelayedEvent
  | DeliveryShippedEvent
  | DeliveryDeliveredEvent
  | AllDeliveriesCompletedEvent
  | ReturnRequestedEvent;

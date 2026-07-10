export const KafkaTopic = {
  // Auth events
  USER_REGISTERED: 'user.registered',
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
  STOCK_LOW: 'stock.low',

  // Order events
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_COMPLETED: 'order.completed',

  // Payment events
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',

  // Delivery events
  DELIVERY_GROUP_CREATED: 'delivery.group.created',
  DELIVERY_SHIPPED: 'delivery.shipped',
  DELIVERY_DELIVERED: 'delivery.delivered',
  ALL_DELIVERIES_COMPLETED: 'delivery.all.completed',
  RETURN_REQUESTED: 'delivery.return.requested',
  RETURN_COMPLETED: 'delivery.return.completed',
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

export interface ProductCreatedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PRODUCT_CREATED;
  payload: {
    productId: string;
    agentId: string;
    name: string;
    price: number;
    categoryId: string;
    brand?: string;
    tags: string[];
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
    items: Array<{ productId: string; agentId: string; quantity: number; unitPrice: number }>;
    totalAmount: number;
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

export interface PaymentCompletedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PAYMENT_COMPLETED;
  payload: {
    paymentId: string;
    orderId: string;
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
    sagaId: string;
    reason: string;
  };
}

export interface PaymentRefundedEvent extends BaseEvent {
  topic: typeof KafkaTopic.PAYMENT_REFUNDED;
  payload: {
    paymentId: string;
    orderId: string;
    refundAmount: number;
    reason: string;
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

export interface DeliveryShippedEvent extends BaseEvent {
  topic: typeof KafkaTopic.DELIVERY_SHIPPED;
  payload: {
    deliveryGroupId: string;
    orderId: string;
    agentId: string;
    courierName: string;
    trackingNumber: string;
    shippedAt: string;
  };
}

export interface DeliveryDeliveredEvent extends BaseEvent {
  topic: typeof KafkaTopic.DELIVERY_DELIVERED;
  payload: {
    deliveryGroupId: string;
    orderId: string;
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
    userId: string;
    refundAmount: number;
    reason: string;
  };
}

export type KafkaEvent =
  | UserRegisteredEvent
  | AgentApprovedEvent
  | ProductCreatedEvent
  | ProductUpdatedEvent
  | InventoryReservedEvent
  | InventoryReservationFailedEvent
  | InventoryReleasedEvent
  | OrderCreatedEvent
  | PaymentCompletedEvent
  | PaymentFailedEvent
  | PaymentRefundedEvent
  | DeliveryGroupCreatedEvent
  | DeliveryShippedEvent
  | DeliveryDeliveredEvent
  | AllDeliveriesCompletedEvent
  | ReturnRequestedEvent;

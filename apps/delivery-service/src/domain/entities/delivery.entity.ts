import { DeliveryGroupStatus } from '@ecommerce/shared';

export interface DeliveryGroup {
  id: string;
  orderId: string;     // ref: order.orders.id
  agentId: string;     // ref: auth.agent_profiles.id
  status: DeliveryGroupStatus;
  shippingFee: number;
  courierName?: string;
  trackingNumber?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  returnedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryGroupItem {
  id: string;
  deliveryGroupId: string;
  productId: string;
  quantity: number;
}

export interface ReturnRequest {
  id: string;
  deliveryGroupId: string;
  orderId: string;
  userId: string;      // ref: auth.users.id
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  refundAmount?: number;
  createdAt: Date;
  updatedAt: Date;
}

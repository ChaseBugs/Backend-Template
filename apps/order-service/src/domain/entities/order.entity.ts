import { OrderStatus } from '@ecommerce/shared';

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;   // ref: product.products.id
  agentId: string;     // ref: auth.agent_profiles.id
  productName: string;
  productImage?: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface ShippingAddress {
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postalCode: string;
}

export interface Order {
  id: string;
  sagaId: string;
  userId: string;       // ref: auth.users.id
  status: OrderStatus;
  items: OrderItem[];
  shippingAddress: ShippingAddress;
  totalAmount: number;
  shippingFee: number;
  discountAmount: number;
  finalAmount: number;
  paymentId?: string;   // ref: payment.payments.id
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

// SAGA state tracking
export interface SagaState {
  sagaId: string;
  orderId: string;
  status: 'STARTED' | 'INVENTORY_RESERVED' | 'PAYMENT_PENDING' | 'COMPLETED' | 'COMPENSATION_STARTED' | 'FAILED';
  items: Array<{ productId: string; quantity: number; agentId: string }>;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

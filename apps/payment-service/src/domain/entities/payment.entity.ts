import { PaymentStatus } from '@ecommerce/shared';

export enum PaymentMethod {
  CARD = 'CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  VIRTUAL_ACCOUNT = 'VIRTUAL_ACCOUNT',
}

export interface Payment {
  id: string;
  orderId: string;    // ref: order.orders.id
  sagaId: string;
  userId: string;     // ref: auth.users.id
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  transactionId?: string;
  idempotencyKey: string;
  failureReason?: string;
  refundAmount?: number;
  refundedAt?: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentSettlement {
  id: string;
  paymentId: string;
  orderId: string;
  agentId: string;
  grossAmount: number;
  commissionRate: number;
  commissionAmount: number;
  netAmount: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'HELD' | 'CANCELLED';
  settledAt?: Date;
  createdAt: Date;
}

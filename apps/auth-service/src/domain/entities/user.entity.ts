import { UserRole, AgentApprovalStatus } from '@ecommerce/shared';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  phone?: string;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentProfile {
  id: string;
  userId: string;
  businessName: string;
  businessNumber: string;
  commissionRate: number;
  approvalStatus: AgentApprovalStatus;
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentShippingPolicy {
  agentId: string;
  baseShippingFee: number;
  freeShippingThreshold?: number;
  remoteAreaFee: number;
  supportedCouriers: string[];
  defaultCourier?: string;
}

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

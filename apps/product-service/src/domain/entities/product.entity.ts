export enum ProductStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  INACTIVE = 'INACTIVE',
}

export interface Product {
  id: string;
  agentId: string;         // ref: auth.agent_profiles.id
  categoryId: string;
  name: string;
  description: string;
  price: number;
  comparePrice?: number;
  brand?: string;
  tags: string[];
  images: string[];
  status: ProductStatus;
  approvedBy?: string;     // ref: auth.users.id
  approvedAt?: Date;
  rejectionReason?: string;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// MongoDB read model — denormalized for fast reads
export interface ProductReadModel {
  _id: string;
  agentId: string;
  agentName: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string;
  price: number;
  comparePrice?: number;
  brand?: string;
  tags: string[];
  images: string[];
  status: ProductStatus;
  stock: number;
  rating: { average: number; count: number };
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

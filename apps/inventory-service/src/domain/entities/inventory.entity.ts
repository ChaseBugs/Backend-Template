export interface Inventory {
  id: string;
  productId: string;   // ref: product.products.id
  agentId: string;     // ref: auth.agent_profiles.id
  quantity: number;
  reservedQuantity: number;
  lowStockThreshold: number;
  updatedAt: Date;
}

export interface StockMovement {
  id: string;
  productId: string;
  type: 'IN' | 'OUT' | 'RESERVE' | 'RELEASE' | 'ADJUST';
  quantity: number;
  referenceId?: string; // orderId, sagaId, etc.
  note?: string;
  createdAt: Date;
}

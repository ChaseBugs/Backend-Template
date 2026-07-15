export interface InventoryHealthRow {
  productId: string;
  quantity: number;
  reservedQuantity: number;
  lowStockThreshold: number;
}

export interface InventoryHealthSummary {
  totalSkus: number;
  outOfStock: number;
  lowStock: number;
  healthy: number;
  lowStockItems: Array<{ productId: string; quantity: number; lowStockThreshold: number }>;
}

export function classifyInventoryHealth(rows: InventoryHealthRow[]): InventoryHealthSummary {
  const summary: InventoryHealthSummary = { totalSkus: rows.length, outOfStock: 0, lowStock: 0, healthy: 0, lowStockItems: [] };

  for (const row of rows) {
    if (row.quantity <= 0) {
      summary.outOfStock += 1;
      summary.lowStockItems.push({ productId: row.productId, quantity: row.quantity, lowStockThreshold: row.lowStockThreshold });
    } else if (row.quantity <= row.lowStockThreshold) {
      summary.lowStock += 1;
      summary.lowStockItems.push({ productId: row.productId, quantity: row.quantity, lowStockThreshold: row.lowStockThreshold });
    } else {
      summary.healthy += 1;
    }
  }

  // Most urgent first so the dashboard surfaces the SKUs closest to lost sales.
  summary.lowStockItems.sort((a, b) => a.quantity - b.quantity);
  return summary;
}

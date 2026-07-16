package com.ecommerce.eshop.model;

import java.io.Serializable;
import java.util.List;

/** Mirrors GET /inventory/agent/summary — apps/inventory-service InventoryHealthSummary. */
public class AgentInventorySummary implements Serializable {
    public int totalSkus;
    public int outOfStock;
    public int lowStock;
    public int healthy;
    public List<LowStockItem> lowStockItems;

    public static class LowStockItem implements Serializable {
        public String productId;
        public int quantity;
        public int lowStockThreshold;
    }
}

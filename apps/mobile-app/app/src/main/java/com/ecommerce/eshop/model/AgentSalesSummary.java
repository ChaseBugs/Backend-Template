package com.ecommerce.eshop.model;

import java.io.Serializable;
import java.util.Map;

/** Mirrors GET /orders/agent/summary — apps/order-service AgentSalesSummary (camelCase, hand-built DTO). */
public class AgentSalesSummary implements Serializable {
    public Period period;
    public Totals totals;
    public Map<String, StatusBreakdown> byStatus;
    public int pendingFulfillment;

    public static class Period implements Serializable {
        public String from;
        public String to;
    }

    public static class Totals implements Serializable {
        public int orderCount;
        public int unitsSold;
        public double grossSales;
    }

    public static class StatusBreakdown implements Serializable {
        public int orderCount;
        public int unitsSold;
        public double grossSales;
    }
}

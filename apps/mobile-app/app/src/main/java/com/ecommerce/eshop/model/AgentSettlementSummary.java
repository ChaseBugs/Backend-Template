package com.ecommerce.eshop.model;

import java.io.Serializable;
import java.util.Map;

/** Mirrors GET /payments/settlements/summary — apps/payment-service AgentPayoutSummary. */
public class AgentSettlementSummary implements Serializable {
    public Map<String, StatusBreakdown> byStatus;
    public double payoutPending;
    public double paidOut;
    public double held;
    public double lifetimeCommission;

    public static class StatusBreakdown implements Serializable {
        public int count;
        public double netAmount;
        public double grossAmount;
        public double commissionAmount;
    }
}

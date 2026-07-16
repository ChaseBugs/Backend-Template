package com.ecommerce.eshop.model;

import java.io.Serializable;

/** Mirrors ads-service's Campaign entity — camelCase DTO, not a raw pg row. */
public class AdCampaign implements Serializable {
    public String id;
    public String agentId;
    public String productId;
    public int costPerClick;
    public int dailyBudget;
    public int totalBudget;
    public int spentTotal;
    public int spentToday;
    public String spendDate;
    public int impressionCount;
    public int clickCount;
    public String status;
    public String rejectionReason;
    public String approvedBy;
    public String approvedAt;
    public String createdAt;
    public String updatedAt;

    public double ctr() {
        return impressionCount > 0 ? (clickCount * 100.0) / impressionCount : 0.0;
    }
}

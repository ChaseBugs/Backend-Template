package com.ecommerce.eshop.model.request;

/** Mirrors ads-service's CreateCampaignSchema — all fields required. */
public class CreateAdCampaignRequest {
    public String productId;
    public int costPerClick;
    public int dailyBudget;
    public int totalBudget;
}

package com.ecommerce.eshop.model.request;

/** Mirrors cart-service's AddItemSchema exactly. */
public class AddCartItemRequest {
    public String productId;
    public int quantity;
    public double unitPrice;
    public String productName;
    public String agentId;

    public AddCartItemRequest(String productId, int quantity, double unitPrice, String productName, String agentId) {
        this.productId = productId;
        this.quantity = quantity;
        this.unitPrice = unitPrice;
        this.productName = productName;
        this.agentId = agentId;
    }
}

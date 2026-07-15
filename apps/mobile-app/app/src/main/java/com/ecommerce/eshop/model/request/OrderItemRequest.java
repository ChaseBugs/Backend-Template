package com.ecommerce.eshop.model.request;

public class OrderItemRequest {
    public String productId;
    public int quantity;

    public OrderItemRequest(String productId, int quantity) {
        this.productId = productId;
        this.quantity = quantity;
    }
}

package com.ecommerce.eshop.model.request;

import com.ecommerce.eshop.model.ProductInfo;
import com.ecommerce.eshop.model.ShippingAddress;

import java.util.List;
import java.util.Map;

/**
 * Mirrors order-service's CreateOrderSchema + the productInfoMap it reads directly off req.body
 * (order-service has no product-service HTTP call in this template — see create-order.use-case.ts —
 * so the client must supply product name/price/agentId for every line item it's ordering).
 */
public class CreateOrderRequest {
    public List<OrderItemRequest> items;
    public ShippingAddress shippingAddress;
    public Map<String, ProductInfo> productInfoMap;

    public CreateOrderRequest(List<OrderItemRequest> items, ShippingAddress shippingAddress, Map<String, ProductInfo> productInfoMap) {
        this.items = items;
        this.shippingAddress = shippingAddress;
        this.productInfoMap = productInfoMap;
    }
}

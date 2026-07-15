package com.ecommerce.eshop.model;

/** Value in the productInfoMap the client must send with order creation — see create-order.use-case.ts. */
public class ProductInfo {
    public String productId;
    public String agentId;
    public String productName;
    public String productImage;
    public double unitPrice;

    public ProductInfo(String productId, String agentId, String productName, String productImage, double unitPrice) {
        this.productId = productId;
        this.agentId = agentId;
        this.productName = productName;
        this.productImage = productImage;
        this.unitPrice = unitPrice;
    }
}

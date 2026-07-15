package com.ecommerce.eshop.model;

import java.io.Serializable;
import java.util.List;

public class CartItem implements Serializable {
    public String productId;
    public String productName;
    public double unitPrice;
    public int quantity;
    public String agentId;
    public List<String> images;

    public double subtotal() {
        return unitPrice * quantity;
    }
}

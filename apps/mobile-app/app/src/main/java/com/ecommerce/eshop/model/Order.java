package com.ecommerce.eshop.model;

import java.util.List;

public class Order {
    public String id;
    public String status;
    public List<OrderItem> items;
    public double totalAmount;
    public String createdAt;
}

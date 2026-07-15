package com.ecommerce.eshop.model;

import java.io.Serializable;

/** Mirrors GET /api/admin/products row shape (product.products p.* plus joined agent_name/quantity_available). */
public class AdminProduct implements Serializable {
    public String id;
    public String agent_id;
    public String category_id;
    public String name;
    public String slug;
    public String description;
    public int price;
    public Integer compare_price;
    public String sku;
    public String status;
    public String rejection_reason;
    public String created_at;
    public String agent_name;
    public Integer quantity_available;

    public boolean lowStock() {
        return quantity_available != null && quantity_available <= 10;
    }
}

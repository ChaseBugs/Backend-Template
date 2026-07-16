package com.ecommerce.eshop.model;

import java.io.Serializable;
import java.util.List;

/**
 * Unifies two distinct backend shapes into one client model:
 *  - GET /products, /products/{id}  -> MongoDB read model (ProductReadModel): _id, agentName, categoryName, stock, rating
 *  - GET /products/my, /products/pending -> Postgres write model (Product): id (no _id), no agentName/categoryName/stock
 * Always read the id via {@link #getProductId()} rather than the raw fields.
 */
public class Product implements Serializable {
    public String _id;
    public String id;
    public String catalogVariantId;
    public String agentId;
    public String agentName;
    public String categoryId;
    public String categoryName;
    public String name;
    public String description;
    public double price;
    public Double comparePrice;
    public String brand;
    public List<String> tags;
    public List<String> images;
    public String status;
    public String rejectionReason;
    public Integer stock;
    public Rating rating;
    public int viewCount;
    public String createdAt;

    public static class Rating implements Serializable {
        public double average;
        public int count;
    }

    public String getProductId() {
        return _id != null ? _id : id;
    }

    public String firstImage() {
        return (images != null && !images.isEmpty()) ? images.get(0) : null;
    }

    public boolean inStock() {
        return stock == null || stock > 0;
    }
}

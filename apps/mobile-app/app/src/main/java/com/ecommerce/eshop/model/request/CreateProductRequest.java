package com.ecommerce.eshop.model.request;

import java.util.ArrayList;
import java.util.List;

/** Mirrors product-service's CreateProductSchema exactly — categoryId is a required UUID, there is no sku/weight field. */
public class CreateProductRequest {
    public String categoryId;
    public String name;
    public String description;
    public double price;
    public Double comparePrice;
    public String brand;
    public List<String> tags = new ArrayList<>();
    public List<String> images = new ArrayList<>();
}

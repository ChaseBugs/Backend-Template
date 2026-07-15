package com.ecommerce.eshop.model.request;

import java.util.List;

/**
 * Mirrors product-service's UpdateProductSchema (CreateProductSchema.partial()) — every
 * field is optional. All fields default to null (not primitives/empty lists) so Gson
 * omits unset fields from the JSON body instead of overwriting them with 0/[] server-side.
 */
public class UpdateProductRequest {
    public String categoryId;
    public String name;
    public String description;
    public Double price;
    public Double comparePrice;
    public String brand;
    public List<String> tags;
    public List<String> images;
}

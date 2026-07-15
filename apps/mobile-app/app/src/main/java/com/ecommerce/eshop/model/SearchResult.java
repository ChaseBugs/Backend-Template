package com.ecommerce.eshop.model;

import java.util.List;

/** search-service returns { products: [...], total } — a custom shape, not the shared PagedList wrapper. */
public class SearchResult {
    public List<Product> products;
    public int total;
}

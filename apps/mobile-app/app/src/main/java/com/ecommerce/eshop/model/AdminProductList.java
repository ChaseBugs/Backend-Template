package com.ecommerce.eshop.model;

import java.io.Serializable;
import java.util.List;

/** Mirrors GET /api/admin/products response: {...PaginatedResult, statusSummary}. */
public class AdminProductList implements Serializable {
    public List<AdminProduct> data;
    public PageMeta meta;
    public List<StatusCount> statusSummary;
}

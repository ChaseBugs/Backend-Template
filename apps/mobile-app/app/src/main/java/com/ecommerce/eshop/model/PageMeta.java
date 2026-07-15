package com.ecommerce.eshop.model;

/** Mirrors packages/shared/src/dtos/pagination.dto.ts PaginatedResult<T>.meta. */
public class PageMeta {
    public int total;
    public int page;
    public int limit;
    public int totalPages;
    public boolean hasNextPage;
    public boolean hasPreviousPage;
}

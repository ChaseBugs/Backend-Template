package com.ecommerce.eshop.model;

import java.util.List;

/**
 * Mirrors packages/shared/src/dtos/pagination.dto.ts PaginatedResult<T> exactly:
 * { data: T[], meta: {...} } — nested one level inside ApiEnvelope.data.
 */
public class PagedList<T> {
    public List<T> data;
    public PageMeta meta;
}

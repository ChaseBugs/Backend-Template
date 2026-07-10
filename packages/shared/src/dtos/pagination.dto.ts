export interface PaginationQuery {
  page?: number | string | string[];
  limit?: number | string | string[];
  sortBy?: string | string[];
  sortOrder?: string | string[];
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export function buildPagination(query: PaginationQuery): { page: number; limit: number; offset: number } {
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const rawLimit = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  const page = Math.max(1, Number(rawPage) || 1);
  const limit = Math.min(100, Math.max(1, Number(rawLimit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function buildPaginatedResult<T>(data: T[], total: number, page: number, limit: number): PaginatedResult<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

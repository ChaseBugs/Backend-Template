package com.ecommerce.eshop.model;

/** Mirrors packages/shared/src/dtos/api-response.dto.ts ApiResponse<T>. */
public class ApiEnvelope<T> {
    public boolean success;
    public T data;
    public ApiErrorBody error;
}

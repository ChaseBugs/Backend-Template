package com.ecommerce.eshop.model.request;

/** Mirrors admin-service's PATCH /api/admin/users/:userId/status body. */
public class UpdateUserStatusRequest {
    public boolean isActive;

    public UpdateUserStatusRequest(boolean isActive) {
        this.isActive = isActive;
    }
}

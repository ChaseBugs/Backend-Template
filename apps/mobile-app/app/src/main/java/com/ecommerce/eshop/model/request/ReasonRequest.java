package com.ecommerce.eshop.model.request;

/** Body shape for endpoints that take an optional/required free-text reason: order cancel, agent/product reject. */
public class ReasonRequest {
    public String reason;

    public ReasonRequest(String reason) {
        this.reason = reason;
    }
}

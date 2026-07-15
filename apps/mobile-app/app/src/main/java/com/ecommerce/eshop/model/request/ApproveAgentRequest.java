package com.ecommerce.eshop.model.request;

/** Mirrors auth-service's ApproveAgentSchema — commissionRate is optional (Gson omits null fields by default). */
public class ApproveAgentRequest {
    public Double commissionRate;

    public ApproveAgentRequest(Double commissionRate) {
        this.commissionRate = commissionRate;
    }
}

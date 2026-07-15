package com.ecommerce.eshop.model;

import java.io.Serializable;

/** Raw pg GROUP BY row shape: {@code SELECT COUNT(*), approval_status ...}. */
public class AgentStatusCount implements Serializable {
    public String count;
    public String approval_status;
}

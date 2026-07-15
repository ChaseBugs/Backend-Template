package com.ecommerce.eshop.model;

import java.io.Serializable;

/** Raw pg GROUP BY row shape: {@code SELECT COUNT(*), status ...}. Field names must match the JSON keys exactly (no Gson naming policy configured). */
public class StatusCount implements Serializable {
    public String count;
    public String status;
}

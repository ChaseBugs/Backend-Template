package com.ecommerce.eshop.model;

import java.io.Serializable;
import java.util.Map;

/** Mirrors GET /deliveries/my/summary — apps/delivery-service FulfillmentSummary. */
public class AgentFulfillmentSummary implements Serializable {
    public Map<String, Integer> byStatus;
    public int toShip;
    public int inTransit;
    public int delivered;
    public int returnRequested;
    public int actionNeeded;
}

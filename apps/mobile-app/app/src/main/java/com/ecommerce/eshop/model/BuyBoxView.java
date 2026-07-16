package com.ecommerce.eshop.model;

import java.io.Serializable;

/** Mirrors GET /products/catalog/variants/{variantId}/buybox — apps/product-service BuyBoxView. */
public class BuyBoxView implements Serializable {
    public String variantId;
    public int offerCount;
    public Double lowestPrice;
    public String winnerAgentId;
    public MyOffer myOffer;
    public boolean iAmWinning;
    public Double priceToWin;

    public static class MyOffer implements Serializable {
        public String productId;
        public double price;
        public String condition;
        public int rank;
    }
}

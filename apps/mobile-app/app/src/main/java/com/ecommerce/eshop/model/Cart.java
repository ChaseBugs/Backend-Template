package com.ecommerce.eshop.model;

import java.util.ArrayList;
import java.util.List;

public class Cart {
    public List<CartItem> items = new ArrayList<>();
    public double total;
    public int count;
}

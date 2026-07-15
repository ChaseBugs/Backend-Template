package com.ecommerce.eshop.model;

/** Mirrors order-service's ShippingAddressSchema exactly (recipientName/addressLine1/city — not name/address). */
public class ShippingAddress {
    public String recipientName;
    public String phone;
    public String addressLine1;
    public String addressLine2;
    public String city;
    public String postalCode;

    public ShippingAddress(String recipientName, String phone, String addressLine1,
                            String addressLine2, String city, String postalCode) {
        this.recipientName = recipientName;
        this.phone = phone;
        this.addressLine1 = addressLine1;
        this.addressLine2 = addressLine2;
        this.city = city;
        this.postalCode = postalCode;
    }
}

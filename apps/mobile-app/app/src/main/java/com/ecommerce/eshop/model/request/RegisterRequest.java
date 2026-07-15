package com.ecommerce.eshop.model.request;

/** Mirrors auth-service's RegisterUserSchema. role must be "user" or "agent" — admin/super-admin cannot self-register. */
public class RegisterRequest {
    public String email;
    public String password;
    public String firstName;
    public String lastName;
    public String phone;
    public String role;
    public String businessName;
    public String businessNumber;
}

package com.ecommerce.eshop.model;

import java.io.Serializable;

/** Mirrors the `user` object returned by auth-service login/register — id,email,role,firstName,lastName only. */
public class User implements Serializable {
    public String id;
    public String email;
    public String role;
    public String firstName;
    public String lastName;

    public boolean isAgent() { return "agent".equals(role); }
    public boolean isAdmin() { return "admin".equals(role) || "super-admin".equals(role); }
    public boolean isUser() { return "user".equals(role); }

    public String displayName() {
        String fn = firstName != null ? firstName : "";
        String ln = lastName != null ? lastName : "";
        return (fn + " " + ln).trim();
    }
}

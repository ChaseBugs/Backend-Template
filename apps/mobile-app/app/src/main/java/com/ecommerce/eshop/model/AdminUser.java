package com.ecommerce.eshop.model;

import java.io.Serializable;

/** Mirrors GET /api/admin/users row shape — raw pg columns, snake_case field names required. */
public class AdminUser implements Serializable {
    public String id;
    public String email;
    public String role;
    public String first_name;
    public String last_name;
    public boolean is_active;
    public String created_at;

    public String displayName() {
        String fn = first_name != null ? first_name : "";
        String ln = last_name != null ? last_name : "";
        String name = (fn + " " + ln).trim();
        return name.isEmpty() ? email : name;
    }
}

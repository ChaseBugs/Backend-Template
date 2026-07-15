package com.ecommerce.eshop.session;

import android.content.Context;
import android.content.SharedPreferences;

import com.ecommerce.eshop.model.User;
import com.google.gson.Gson;

public class SessionManager {
    private static final String PREFS_NAME = "eshop_session";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_USER = "user";

    private final SharedPreferences prefs;
    private final Gson gson = new Gson();

    public SessionManager(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public void saveSession(String token, User user) {
        prefs.edit()
                .putString(KEY_TOKEN, token)
                .putString(KEY_USER, gson.toJson(user))
                .apply();
    }

    public String getToken() {
        return prefs.getString(KEY_TOKEN, null);
    }

    public User getUser() {
        String json = prefs.getString(KEY_USER, null);
        if (json == null) return null;
        return gson.fromJson(json, User.class);
    }

    public boolean isLoggedIn() {
        return getToken() != null && getUser() != null;
    }

    public void clearSession() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_USER).apply();
    }
}

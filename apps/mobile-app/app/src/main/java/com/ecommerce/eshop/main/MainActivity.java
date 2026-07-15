package com.ecommerce.eshop.main;

import android.content.Intent;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.Fragment;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.admin.AdminFragment;
import com.ecommerce.eshop.agent.AgentProductsFragment;
import com.ecommerce.eshop.auth.LoginActivity;
import com.ecommerce.eshop.cart.CartFragment;
import com.ecommerce.eshop.home.HomeFragment;
import com.ecommerce.eshop.model.User;
import com.ecommerce.eshop.orders.OrdersFragment;
import com.ecommerce.eshop.profile.ProfileFragment;
import com.ecommerce.eshop.search.SearchFragment;
import com.ecommerce.eshop.session.SessionManager;
import com.google.android.material.bottomnavigation.BottomNavigationView;

/** Single-activity shell hosting the bottom-nav tabs, role-gated in setupMenuForRole(). */
public class MainActivity extends AppCompatActivity {

    public static final String EXTRA_TAB = "extra_tab";

    private SessionManager sessionManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        sessionManager = new SessionManager(this);
        if (!sessionManager.isLoggedIn()) {
            goToLogin();
            return;
        }

        BottomNavigationView bottomNav = findViewById(R.id.bottomNav);
        setupMenuForRole(bottomNav);

        bottomNav.setOnItemSelectedListener(this::onNavItemSelected);

        if (savedInstanceState == null) {
            applyRequestedTab(bottomNav, getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        BottomNavigationView bottomNav = findViewById(R.id.bottomNav);
        applyRequestedTab(bottomNav, intent);
    }

    private void applyRequestedTab(BottomNavigationView bottomNav, Intent intent) {
        String requestedTab = intent.getStringExtra(EXTRA_TAB);
        if ("cart".equals(requestedTab)) {
            bottomNav.setSelectedItemId(R.id.nav_cart);
        } else if ("orders".equals(requestedTab)) {
            bottomNav.setSelectedItemId(R.id.nav_orders);
        } else {
            bottomNav.setSelectedItemId(R.id.nav_home);
        }
    }

    private void setupMenuForRole(BottomNavigationView bottomNav) {
        User user = sessionManager.getUser();
        Menu menu = bottomNav.getMenu();
        MenuItem agentItem = menu.findItem(R.id.nav_agent);
        MenuItem adminItem = menu.findItem(R.id.nav_admin);
        if (agentItem != null) agentItem.setVisible(user != null && user.isAgent());
        if (adminItem != null) adminItem.setVisible(user != null && user.isAdmin());
    }

    private boolean onNavItemSelected(@NonNull MenuItem item) {
        int id = item.getItemId();
        if (id == R.id.nav_home) {
            showFragment(new HomeFragment());
            return true;
        } else if (id == R.id.nav_search) {
            showFragment(new SearchFragment());
            return true;
        } else if (id == R.id.nav_cart) {
            showFragment(new CartFragment());
            return true;
        } else if (id == R.id.nav_orders) {
            showFragment(new OrdersFragment());
            return true;
        } else if (id == R.id.nav_agent) {
            showFragment(new AgentProductsFragment());
            return true;
        } else if (id == R.id.nav_admin) {
            showFragment(new AdminFragment());
            return true;
        } else if (id == R.id.nav_profile) {
            showFragment(new ProfileFragment());
            return true;
        }
        return false;
    }

    private void showFragment(Fragment fragment) {
        getSupportFragmentManager()
                .beginTransaction()
                .replace(R.id.fragmentContainer, fragment)
                .commit();
    }

    public void logout() {
        sessionManager.clearSession();
        goToLogin();
    }

    private void goToLogin() {
        Intent intent = new Intent(this, LoginActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }
}

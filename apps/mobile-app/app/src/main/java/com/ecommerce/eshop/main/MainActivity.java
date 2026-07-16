package com.ecommerce.eshop.main;

import android.content.Intent;
import android.content.res.ColorStateList;
import android.os.Bundle;
import android.view.MenuItem;
import android.view.View;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.admin.AdminAgentsFragment;
import com.ecommerce.eshop.admin.AdminHomeFragment;
import com.ecommerce.eshop.admin.AdminProductsFragment;
import com.ecommerce.eshop.admin.AdminUsersFragment;
import com.ecommerce.eshop.agent.AgentAdsFragment;
import com.ecommerce.eshop.agent.AgentEarningsFragment;
import com.ecommerce.eshop.agent.AgentHomeFragment;
import com.ecommerce.eshop.agent.AgentOrdersFragment;
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

/**
 * Single-activity shell. Each role gets its own bottom-nav menu and tab set —
 * agent/admin use the dark dashboard design, user keeps the light shopper theme.
 */
public class MainActivity extends AppCompatActivity {

    public static final String EXTRA_TAB = "extra_tab";

    private SessionManager sessionManager;
    private User user;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        sessionManager = new SessionManager(this);
        if (!sessionManager.isLoggedIn()) {
            goToLogin();
            return;
        }
        user = sessionManager.getUser();

        BottomNavigationView bottomNav = findViewById(R.id.bottomNav);
        View fragmentContainer = findViewById(R.id.fragmentContainer);
        setupNavForRole(bottomNav, fragmentContainer);

        bottomNav.setOnItemSelectedListener(this::onNavItemSelected);

        if (savedInstanceState == null) {
            applyRequestedTab(bottomNav, getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (user != null && user.isUser()) {
            BottomNavigationView bottomNav = findViewById(R.id.bottomNav);
            applyRequestedTab(bottomNav, intent);
        }
    }

    private void applyRequestedTab(BottomNavigationView bottomNav, Intent intent) {
        if (user == null || !user.isUser()) return;
        String requestedTab = intent.getStringExtra(EXTRA_TAB);
        if ("cart".equals(requestedTab)) {
            bottomNav.setSelectedItemId(R.id.nav_cart);
        } else if ("orders".equals(requestedTab)) {
            bottomNav.setSelectedItemId(R.id.nav_orders);
        } else {
            bottomNav.setSelectedItemId(R.id.nav_home);
        }
    }

    private void setupNavForRole(BottomNavigationView bottomNav, View fragmentContainer) {
        if (user != null && user.isAgent()) {
            bottomNav.getMenu().clear();
            getMenuInflater().inflate(R.menu.bottom_nav_menu_agent, bottomNav.getMenu());
            applyDashboardChrome(bottomNav, fragmentContainer);
            bottomNav.setSelectedItemId(R.id.nav_agent_home);
            showFragment(new AgentHomeFragment());
        } else if (user != null && user.isAdmin()) {
            bottomNav.getMenu().clear();
            getMenuInflater().inflate(R.menu.bottom_nav_menu_admin, bottomNav.getMenu());
            applyDashboardChrome(bottomNav, fragmentContainer);
            bottomNav.setSelectedItemId(R.id.nav_admin_home);
            showFragment(new AdminHomeFragment());
        } else {
            bottomNav.getMenu().clear();
            getMenuInflater().inflate(R.menu.bottom_nav_menu_user, bottomNav.getMenu());
            showFragment(new HomeFragment());
        }
    }

    private void applyDashboardChrome(BottomNavigationView bottomNav, View fragmentContainer) {
        bottomNav.setBackgroundColor(ContextCompat.getColor(this, R.color.dash_surface));
        ColorStateList tint = ContextCompat.getColorStateList(this, R.color.dash_bottom_nav_tint);
        bottomNav.setItemIconTintList(tint);
        bottomNav.setItemTextColor(tint);
        fragmentContainer.setBackgroundColor(ContextCompat.getColor(this, R.color.dash_bg));
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
        } else if (id == R.id.nav_profile) {
            showFragment(new ProfileFragment());
            return true;
        } else if (id == R.id.nav_agent_home) {
            showFragment(new AgentHomeFragment());
            return true;
        } else if (id == R.id.nav_agent_products) {
            showFragment(new AgentProductsFragment());
            return true;
        } else if (id == R.id.nav_agent_orders) {
            showFragment(new AgentOrdersFragment());
            return true;
        } else if (id == R.id.nav_agent_earnings) {
            showFragment(new AgentEarningsFragment());
            return true;
        } else if (id == R.id.nav_agent_ads) {
            showFragment(new AgentAdsFragment());
            return true;
        } else if (id == R.id.nav_admin_home) {
            showFragment(new AdminHomeFragment());
            return true;
        } else if (id == R.id.nav_admin_agents) {
            showFragment(new AdminAgentsFragment());
            return true;
        } else if (id == R.id.nav_admin_products) {
            showFragment(new AdminProductsFragment());
            return true;
        } else if (id == R.id.nav_admin_users) {
            showFragment(new AdminUsersFragment());
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

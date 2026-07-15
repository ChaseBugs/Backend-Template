package com.ecommerce.eshop.agent;

import android.content.res.ColorStateList;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.Order;
import com.ecommerce.eshop.model.OrderItem;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.Product;
import com.ecommerce.eshop.session.SessionManager;

import java.util.List;

public class AgentHomeFragment extends Fragment {

    private static final int RECENT_ORDERS_LIMIT = 3;

    private ApiService apiService;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvGreeting;
    private TextView tvProductCount;
    private TextView tvOrderCount;
    private LinearLayout recentOrdersList;
    private TextView tvNoOrders;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_agent_home, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvGreeting = view.findViewById(R.id.tvGreeting);
        tvProductCount = view.findViewById(R.id.tvProductCount);
        tvOrderCount = view.findViewById(R.id.tvOrderCount);
        recentOrdersList = view.findViewById(R.id.recentOrdersList);
        tvNoOrders = view.findViewById(R.id.tvNoOrders);

        SessionManager sessionManager = new SessionManager(requireContext());
        if (sessionManager.getUser() != null) {
            String name = sessionManager.getUser().displayName();
            tvGreeting.setText((name.isEmpty() ? "안녕하세요" : name + "님") + " 👋");
        }

        swipeRefresh.setOnRefreshListener(this::load);
        load();
    }

    private void load() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        apiService.listMyProducts(1, 100).enqueue(new ApiCallback<PagedList<Product>>() {
            @Override
            public void onSuccess(PagedList<Product> data) {
                if (!isAdded()) return;
                int count = data != null && data.data != null ? data.data.size() : 0;
                tvProductCount.setText(String.valueOf(count));
            }

            @Override
            public void onError(String message) {
                // stat card silently keeps its default — order call below still resolves the refresh spinner
            }
        });

        apiService.listOrders(1, 50).enqueue(new ApiCallback<PagedList<Order>>() {
            @Override
            public void onSuccess(PagedList<Order> data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                List<Order> orders = data != null ? data.data : null;
                int count = orders != null ? orders.size() : 0;
                tvOrderCount.setText(String.valueOf(count));
                bindRecentOrders(orders);
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void bindRecentOrders(List<Order> orders) {
        recentOrdersList.removeAllViews();
        if (orders == null || orders.isEmpty()) {
            tvNoOrders.setVisibility(View.VISIBLE);
            return;
        }
        tvNoOrders.setVisibility(View.GONE);

        int limit = Math.min(RECENT_ORDERS_LIMIT, orders.size());
        LayoutInflater inflater = LayoutInflater.from(requireContext());
        for (int i = 0; i < limit; i++) {
            Order order = orders.get(i);
            View row = inflater.inflate(R.layout.item_agent_order, recentOrdersList, false);

            TextView tvOrderId = row.findViewById(R.id.tvOrderId);
            TextView tvDate = row.findViewById(R.id.tvDate);
            TextView tvStatus = row.findViewById(R.id.tvStatus);
            TextView tvTotal = row.findViewById(R.id.tvTotal);
            LinearLayout itemsContainer = row.findViewById(R.id.itemsContainer);

            tvOrderId.setText("주문 #" + shortId(order.id));
            tvDate.setText(order.createdAt != null ? order.createdAt : "");
            tvStatus.setText(order.status);
            tvStatus.setBackgroundTintList(ColorStateList.valueOf(
                    ContextCompat.getColor(requireContext(), R.color.dash_accent)));
            tvTotal.setText("합계 " + ProductAdapter.formatWon(order.totalAmount));

            if (order.items != null) {
                for (OrderItem item : order.items) {
                    TextView itemRow = new TextView(requireContext());
                    itemRow.setText("• " + item.productName + " × " + item.quantity);
                    itemRow.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_text_secondary));
                    itemRow.setTextSize(12);
                    itemsContainer.addView(itemRow);
                }
            }

            recentOrdersList.addView(row);
        }
    }

    private static String shortId(String id) {
        if (id == null) return "";
        return id.length() > 8 ? id.substring(0, 8) : id;
    }
}

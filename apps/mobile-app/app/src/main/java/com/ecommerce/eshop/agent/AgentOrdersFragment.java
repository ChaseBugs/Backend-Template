package com.ecommerce.eshop.agent;

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
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.model.Order;
import com.ecommerce.eshop.model.PagedList;

import java.util.ArrayList;
import java.util.List;

public class AgentOrdersFragment extends Fragment {

    private static final String[] FILTER_LABELS = {"전체", "결제완료", "배송중", "완료", "취소"};
    private static final String[] FILTER_STATUSES = {null, "PAID", "SHIPPED", "COMPLETED", "CANCELLED"};

    private ApiService apiService;
    private AgentOrderAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private LinearLayout filterChips;

    private final List<Order> allOrders = new ArrayList<>();
    private int selectedFilter = 0;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_agent_orders, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        RecyclerView rvOrders = view.findViewById(R.id.rvOrders);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvEmpty = view.findViewById(R.id.tvEmpty);
        filterChips = view.findViewById(R.id.filterChips);

        adapter = new AgentOrderAdapter();
        rvOrders.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvOrders.setAdapter(adapter);

        buildFilterChips();
        swipeRefresh.setOnRefreshListener(this::load);
        load();
    }

    private void buildFilterChips() {
        filterChips.removeAllViews();
        for (int i = 0; i < FILTER_LABELS.length; i++) {
            int index = i;
            TextView chip = new TextView(requireContext());
            chip.setText(FILTER_LABELS[i]);
            chip.setTextSize(13);
            chip.setPadding(dp(16), dp(8), dp(16), dp(8));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.setMarginEnd(dp(8));
            chip.setLayoutParams(params);
            chip.setOnClickListener(v -> {
                selectedFilter = index;
                buildFilterChips();
                renderFiltered();
            });
            filterChips.addView(chip);
        }
        applyChipStyles();
    }

    private void applyChipStyles() {
        for (int i = 0; i < filterChips.getChildCount(); i++) {
            TextView chip = (TextView) filterChips.getChildAt(i);
            boolean selected = i == selectedFilter;
            chip.setBackgroundResource(selected ? R.drawable.dash_chip_selected : R.drawable.dash_chip_unselected);
            chip.setTextColor(ContextCompat.getColor(requireContext(), selected ? R.color.white : R.color.dash_text_secondary));
        }
    }

    private void load() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        apiService.listOrders(1, 50).enqueue(new ApiCallback<PagedList<Order>>() {
            @Override
            public void onSuccess(PagedList<Order> data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                allOrders.clear();
                if (data != null && data.data != null) allOrders.addAll(data.data);
                renderFiltered();
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

    private void renderFiltered() {
        String statusFilter = FILTER_STATUSES[selectedFilter];
        List<Order> filtered = new ArrayList<>();
        for (Order order : allOrders) {
            if (statusFilter == null || statusFilter.equals(order.status)) filtered.add(order);
        }
        tvEmpty.setVisibility(filtered.isEmpty() ? View.VISIBLE : View.GONE);
        adapter.setOrders(filtered);
    }

    private int dp(int value) {
        float density = requireContext().getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }
}

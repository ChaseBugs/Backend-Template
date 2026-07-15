package com.ecommerce.eshop.admin;

import android.app.AlertDialog;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
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
import com.ecommerce.eshop.model.AdminProduct;
import com.ecommerce.eshop.model.AdminProductList;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.request.ReasonRequest;

import java.util.HashMap;

public class AdminProductsFragment extends Fragment {

    private static final String[] FILTER_LABELS = {"전체", "판매중", "승인 대기", "거절됨", "비활성"};
    private static final String[] FILTER_STATUSES = {null, "ACTIVE", "PENDING_APPROVAL", "REJECTED", "INACTIVE"};

    private ApiService apiService;
    private AdminProductAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private LinearLayout filterChips;
    private int selectedFilter = 0;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_admin_products, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        RecyclerView rvList = view.findViewById(R.id.rvList);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvEmpty = view.findViewById(R.id.tvEmpty);
        filterChips = view.findViewById(R.id.filterChips);

        adapter = new AdminProductAdapter(new AdminProductAdapter.Listener() {
            @Override
            public void onApprove(AdminProduct product) {
                approve(product);
            }

            @Override
            public void onReject(AdminProduct product) {
                promptReject(product);
            }
        });
        rvList.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvList.setAdapter(adapter);

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
                load();
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
        String status = FILTER_STATUSES[selectedFilter];
        apiService.listAdminProducts(1, 100, status, null).enqueue(new ApiCallback<AdminProductList>() {
            @Override
            public void onSuccess(AdminProductList data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                boolean empty = data == null || data.data == null || data.data.isEmpty();
                tvEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
                adapter.setProducts(data != null ? data.data : null);
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

    private void approve(AdminProduct product) {
        apiService.approveProduct(product.id, new HashMap<String, String>())
                .enqueue(new ApiCallback<MessageResponse>() {
                    @Override
                    public void onSuccess(MessageResponse data) {
                        if (!isAdded()) return;
                        Toast.makeText(requireContext(), "상품이 승인되었습니다.", Toast.LENGTH_SHORT).show();
                        load();
                    }

                    @Override
                    public void onError(String message) {
                        if (!isAdded()) return;
                        Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
                    }
                });
    }

    private void promptReject(AdminProduct product) {
        EditText input = new EditText(requireContext());
        input.setHint("거절 사유를 입력하세요");
        new AlertDialog.Builder(requireContext())
                .setTitle("상품 거절")
                .setView(input)
                .setPositiveButton("거절", (dialog, which) -> {
                    String reason = input.getText() != null ? input.getText().toString().trim() : "";
                    if (TextUtils.isEmpty(reason)) {
                        Toast.makeText(requireContext(), "거절 사유를 입력해주세요.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    reject(product, reason);
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private void reject(AdminProduct product, String reason) {
        apiService.rejectProduct(product.id, new ReasonRequest(reason))
                .enqueue(new ApiCallback<MessageResponse>() {
                    @Override
                    public void onSuccess(MessageResponse data) {
                        if (!isAdded()) return;
                        Toast.makeText(requireContext(), "상품이 거절되었습니다.", Toast.LENGTH_SHORT).show();
                        load();
                    }

                    @Override
                    public void onError(String message) {
                        if (!isAdded()) return;
                        Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
                    }
                });
    }

    private int dp(int value) {
        float density = requireContext().getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }
}

package com.ecommerce.eshop.admin;

import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.Product;
import com.ecommerce.eshop.model.request.ReasonRequest;
import com.ecommerce.eshop.product.ProductDetailActivity;

import java.util.HashMap;
import java.util.Map;

public class AdminProductsFragment extends Fragment {

    private ApiService apiService;
    private PendingProductAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;

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

        adapter = new PendingProductAdapter(new PendingProductAdapter.Listener() {
            @Override
            public void onApprove(Product product) {
                approve(product);
            }

            @Override
            public void onReject(Product product) {
                promptReject(product);
            }

            @Override
            public void onView(Product product) {
                Intent intent = new Intent(requireContext(), ProductDetailActivity.class);
                intent.putExtra(ProductDetailActivity.EXTRA_PRODUCT_ID, product.getProductId());
                startActivity(intent);
            }
        });
        rvList.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvList.setAdapter(adapter);

        swipeRefresh.setOnRefreshListener(this::load);
        load();
    }

    private void load() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        apiService.listPendingProducts(1, 50).enqueue(new ApiCallback<PagedList<Product>>() {
            @Override
            public void onSuccess(PagedList<Product> data) {
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

    private void approve(Product product) {
        apiService.approveProduct(product.getProductId(), new HashMap<String, String>())
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

    private void promptReject(Product product) {
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

    private void reject(Product product, String reason) {
        apiService.rejectProduct(product.getProductId(), new ReasonRequest(reason))
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
}

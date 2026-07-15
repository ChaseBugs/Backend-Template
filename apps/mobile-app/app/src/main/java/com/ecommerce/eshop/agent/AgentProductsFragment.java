package com.ecommerce.eshop.agent;

import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
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
import com.ecommerce.eshop.product.ProductDetailActivity;

public class AgentProductsFragment extends Fragment {

    private ApiService apiService;
    private AgentProductAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_agent_products, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        RecyclerView rvMyProducts = view.findViewById(R.id.rvMyProducts);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvEmpty = view.findViewById(R.id.tvEmpty);
        Button btnAddProduct = view.findViewById(R.id.btnAddProduct);

        adapter = new AgentProductAdapter(new AgentProductAdapter.Listener() {
            @Override
            public void onView(Product product) {
                Intent intent = new Intent(requireContext(), ProductDetailActivity.class);
                intent.putExtra(ProductDetailActivity.EXTRA_PRODUCT_ID, product.getProductId());
                startActivity(intent);
            }

            @Override
            public void onDelete(Product product) {
                confirmDelete(product);
            }
        });
        rvMyProducts.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvMyProducts.setAdapter(adapter);

        swipeRefresh.setOnRefreshListener(this::loadMyProducts);
        btnAddProduct.setOnClickListener(v -> startActivity(new Intent(requireContext(), AddProductActivity.class)));

        loadMyProducts();
    }

    @Override
    public void onResume() {
        super.onResume();
        loadMyProducts();
    }

    private void loadMyProducts() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        apiService.listMyProducts(1, 50).enqueue(new ApiCallback<PagedList<Product>>() {
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

    private void confirmDelete(Product product) {
        new AlertDialog.Builder(requireContext())
                .setMessage(product.name + " 상품을 삭제하시겠습니까?")
                .setPositiveButton("삭제", (dialog, which) -> deleteProduct(product))
                .setNegativeButton("취소", null)
                .show();
    }

    private void deleteProduct(Product product) {
        apiService.deleteProduct(product.getProductId()).enqueue(new ApiCallback<MessageResponse>() {
            @Override
            public void onSuccess(MessageResponse data) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "삭제되었습니다.", Toast.LENGTH_SHORT).show();
                loadMyProducts();
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
            }
        });
    }
}

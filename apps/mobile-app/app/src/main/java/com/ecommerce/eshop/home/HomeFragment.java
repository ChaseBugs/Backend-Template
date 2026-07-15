package com.ecommerce.eshop.home;

import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.Product;
import com.ecommerce.eshop.product.ProductDetailActivity;

import java.util.List;

public class HomeFragment extends Fragment {

    private static final String[] SORT_LABELS = {"최신순", "낮은가격순", "높은가격순"};
    private static final String[] SORT_BY = {"createdAt", "price", "price"};
    private static final String[] SORT_ORDER = {"desc", "asc", "desc"};
    private static final int PAGE_SIZE = 12;

    private ApiService apiService;
    private ProductAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private TextView tvPageIndicator;
    private Button btnPrevPage;
    private Button btnNextPage;
    private Spinner spinnerSort;

    private int currentPage = 1;
    private int totalPages = 1;
    private int sortIndex = 0;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_home, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        RecyclerView rvProducts = view.findViewById(R.id.rvProducts);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvEmpty = view.findViewById(R.id.tvEmpty);
        tvPageIndicator = view.findViewById(R.id.tvPageIndicator);
        btnPrevPage = view.findViewById(R.id.btnPrevPage);
        btnNextPage = view.findViewById(R.id.btnNextPage);
        spinnerSort = view.findViewById(R.id.spinnerSort);

        adapter = new ProductAdapter(this::openProductDetail);
        rvProducts.setLayoutManager(new GridLayoutManager(requireContext(), 2));
        rvProducts.setAdapter(adapter);

        ArrayAdapter<String> sortAdapter = new ArrayAdapter<>(requireContext(), android.R.layout.simple_spinner_item, SORT_LABELS);
        sortAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinnerSort.setAdapter(sortAdapter);
        spinnerSort.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View v, int position, long id) {
                sortIndex = position;
                loadPage(1);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) { }
        });

        swipeRefresh.setOnRefreshListener(() -> loadPage(currentPage));
        btnPrevPage.setOnClickListener(v -> { if (currentPage > 1) loadPage(currentPage - 1); });
        btnNextPage.setOnClickListener(v -> { if (currentPage < totalPages) loadPage(currentPage + 1); });

        loadPage(1);
    }

    private void openProductDetail(Product product) {
        Intent intent = new Intent(requireContext(), ProductDetailActivity.class);
        intent.putExtra(ProductDetailActivity.EXTRA_PRODUCT_ID, product.getProductId());
        startActivity(intent);
    }

    private void loadPage(int page) {
        if (!isAdded()) return;
        setLoading(true);
        apiService.listProducts(page, PAGE_SIZE, SORT_BY[sortIndex], SORT_ORDER[sortIndex])
                .enqueue(new ApiCallback<PagedList<Product>>() {
                    @Override
                    public void onSuccess(PagedList<Product> data) {
                        if (!isAdded()) return;
                        setLoading(false);
                        currentPage = data.meta != null ? data.meta.page : page;
                        totalPages = data.meta != null ? Math.max(1, data.meta.totalPages) : 1;
                        List<Product> items = data.data;
                        adapter.setProducts(items);
                        tvEmpty.setVisibility(items == null || items.isEmpty() ? View.VISIBLE : View.GONE);
                        tvPageIndicator.setText(currentPage + " / " + totalPages);
                        btnPrevPage.setEnabled(currentPage > 1);
                        btnNextPage.setEnabled(currentPage < totalPages);
                    }

                    @Override
                    public void onError(String message) {
                        if (!isAdded()) return;
                        setLoading(false);
                        Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
                    }
                });
    }

    private void setLoading(boolean loading) {
        swipeRefresh.setRefreshing(false);
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
    }
}

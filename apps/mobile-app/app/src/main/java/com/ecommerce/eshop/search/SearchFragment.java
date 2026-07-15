package com.ecommerce.eshop.search;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.Product;
import com.ecommerce.eshop.model.SearchResult;
import com.ecommerce.eshop.product.ProductDetailActivity;

public class SearchFragment extends Fragment {

    private ApiService apiService;
    private ProductAdapter adapter;
    private EditText etQuery;
    private ProgressBar progressBar;
    private TextView tvEmpty;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_search, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        etQuery = view.findViewById(R.id.etQuery);
        Button btnSearch = view.findViewById(R.id.btnSearch);
        RecyclerView rvResults = view.findViewById(R.id.rvResults);
        progressBar = view.findViewById(R.id.progressBar);
        tvEmpty = view.findViewById(R.id.tvEmpty);

        adapter = new ProductAdapter(this::openProductDetail);
        rvResults.setLayoutManager(new GridLayoutManager(requireContext(), 2));
        rvResults.setAdapter(adapter);

        btnSearch.setOnClickListener(v -> doSearch());
        etQuery.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                doSearch();
                return true;
            }
            return false;
        });
    }

    private void openProductDetail(Product product) {
        Intent intent = new Intent(requireContext(), ProductDetailActivity.class);
        intent.putExtra(ProductDetailActivity.EXTRA_PRODUCT_ID, product.getProductId());
        startActivity(intent);
    }

    private void doSearch() {
        String query = etQuery.getText() != null ? etQuery.getText().toString().trim() : "";
        if (TextUtils.isEmpty(query)) return;
        if (!isAdded()) return;

        progressBar.setVisibility(View.VISIBLE);
        tvEmpty.setVisibility(View.GONE);

        apiService.search(query, 20).enqueue(new ApiCallback<SearchResult>() {
            @Override
            public void onSuccess(SearchResult data) {
                if (!isAdded()) return;
                progressBar.setVisibility(View.GONE);
                boolean empty = data == null || data.products == null || data.products.isEmpty();
                if (empty) {
                    adapter.setProducts(null);
                    tvEmpty.setText("🔍\n검색 결과가 없습니다.");
                    tvEmpty.setVisibility(View.VISIBLE);
                } else {
                    adapter.setProducts(data.products);
                }
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) return;
                progressBar.setVisibility(View.GONE);
                Toast.makeText(requireContext(), "검색 서비스 오류: " + message, Toast.LENGTH_SHORT).show();
            }
        });
    }
}

package com.ecommerce.eshop.cart;

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
import com.ecommerce.eshop.checkout.CheckoutActivity;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.Cart;
import com.ecommerce.eshop.model.CartItem;
import com.ecommerce.eshop.model.MessageResponse;
import com.google.android.material.bottomnavigation.BottomNavigationView;

public class CartFragment extends Fragment {

    private ApiService apiService;
    private CartAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private View emptyLayout;
    private View footerSummary;
    private TextView tvTotal;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_cart, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        RecyclerView rvCartItems = view.findViewById(R.id.rvCartItems);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        emptyLayout = view.findViewById(R.id.emptyLayout);
        footerSummary = view.findViewById(R.id.footerSummary);
        tvTotal = view.findViewById(R.id.tvTotal);
        Button btnCheckout = view.findViewById(R.id.btnCheckout);
        Button btnClearCart = view.findViewById(R.id.btnClearCart);
        Button btnGoShopping = view.findViewById(R.id.btnGoShopping);

        adapter = new CartAdapter(new CartAdapter.Listener() {
            @Override
            public void onQuantityChange(CartItem item, int newQuantity) {
                updateQuantity(item.productId, newQuantity);
            }

            @Override
            public void onRemove(CartItem item) {
                removeItem(item.productId);
            }
        });
        rvCartItems.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvCartItems.setAdapter(adapter);

        swipeRefresh.setOnRefreshListener(this::loadCart);
        btnCheckout.setOnClickListener(v -> startActivity(new Intent(requireContext(), CheckoutActivity.class)));
        btnClearCart.setOnClickListener(v -> confirmClear());
        btnGoShopping.setOnClickListener(v -> {
            BottomNavigationView bottomNav = requireActivity().findViewById(R.id.bottomNav);
            bottomNav.setSelectedItemId(R.id.nav_home);
        });

        loadCart();
    }

    @Override
    public void onResume() {
        super.onResume();
        loadCart();
    }

    private void loadCart() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        apiService.getCart().enqueue(new ApiCallback<Cart>() {
            @Override
            public void onSuccess(Cart data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                boolean empty = data == null || data.items == null || data.items.isEmpty();
                emptyLayout.setVisibility(empty ? View.VISIBLE : View.GONE);
                footerSummary.setVisibility(empty ? View.GONE : View.VISIBLE);
                if (!empty) {
                    adapter.setItems(data.items);
                    tvTotal.setText(ProductAdapter.formatWon(data.total));
                }
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

    private void updateQuantity(String productId, int quantity) {
        apiService.updateCartItem(productId, new com.ecommerce.eshop.model.request.UpdateQuantityRequest(quantity))
                .enqueue(new ApiCallback<MessageResponse>() {
                    @Override
                    public void onSuccess(MessageResponse data) {
                        loadCart();
                    }

                    @Override
                    public void onError(String message) {
                        if (!isAdded()) return;
                        Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
                    }
                });
    }

    private void removeItem(String productId) {
        apiService.removeCartItem(productId).enqueue(new ApiCallback<MessageResponse>() {
            @Override
            public void onSuccess(MessageResponse data) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "삭제되었습니다.", Toast.LENGTH_SHORT).show();
                loadCart();
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void confirmClear() {
        new AlertDialog.Builder(requireContext())
                .setMessage("장바구니를 비우시겠습니까?")
                .setPositiveButton("비우기", (dialog, which) -> apiService.clearCart().enqueue(new ApiCallback<MessageResponse>() {
                    @Override
                    public void onSuccess(MessageResponse data) {
                        if (!isAdded()) return;
                        Toast.makeText(requireContext(), "장바구니를 비웠습니다.", Toast.LENGTH_SHORT).show();
                        loadCart();
                    }

                    @Override
                    public void onError(String message) {
                        if (!isAdded()) return;
                        Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
                    }
                }))
                .setNegativeButton("취소", null)
                .show();
    }
}

package com.ecommerce.eshop.orders;

import android.app.AlertDialog;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
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
import com.ecommerce.eshop.model.Order;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.request.ReasonRequest;

public class OrdersFragment extends Fragment {

    private ApiService apiService;
    private OrderAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_orders, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        RecyclerView rvOrders = view.findViewById(R.id.rvOrders);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvEmpty = view.findViewById(R.id.tvEmpty);

        adapter = new OrderAdapter(this::confirmCancel);
        rvOrders.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvOrders.setAdapter(adapter);

        swipeRefresh.setOnRefreshListener(this::loadOrders);
        loadOrders();
    }

    @Override
    public void onResume() {
        super.onResume();
        loadOrders();
    }

    private void loadOrders() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        apiService.listOrders(1, 50).enqueue(new ApiCallback<PagedList<Order>>() {
            @Override
            public void onSuccess(PagedList<Order> data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                boolean empty = data == null || data.data == null || data.data.isEmpty();
                tvEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
                adapter.setOrders(data != null ? data.data : null);
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

    private void confirmCancel(Order order) {
        new AlertDialog.Builder(requireContext())
                .setMessage("정말 취소하시겠습니까?")
                .setPositiveButton("취소하기", (dialog, which) -> cancelOrder(order))
                .setNegativeButton("닫기", null)
                .show();
    }

    private void cancelOrder(Order order) {
        apiService.cancelOrder(order.id, new ReasonRequest("사용자 요청으로 취소"))
                .enqueue(new ApiCallback<MessageResponse>() {
                    @Override
                    public void onSuccess(MessageResponse data) {
                        if (!isAdded()) return;
                        Toast.makeText(requireContext(), "주문이 취소되었습니다.", Toast.LENGTH_SHORT).show();
                        loadOrders();
                    }

                    @Override
                    public void onError(String message) {
                        if (!isAdded()) return;
                        Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
                    }
                });
    }
}

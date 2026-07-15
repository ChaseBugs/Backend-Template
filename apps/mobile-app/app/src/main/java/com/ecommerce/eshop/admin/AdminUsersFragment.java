package com.ecommerce.eshop.admin;

import android.app.AlertDialog;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
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
import com.ecommerce.eshop.model.AdminUser;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.request.UpdateUserStatusRequest;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class AdminUsersFragment extends Fragment {

    private ApiService apiService;
    private AdminUserAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private EditText etSearch;

    private final List<AdminUser> allUsers = new ArrayList<>();
    private String query = "";

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_admin_users, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        RecyclerView rvList = view.findViewById(R.id.rvList);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvEmpty = view.findViewById(R.id.tvEmpty);
        etSearch = view.findViewById(R.id.etSearch);

        adapter = new AdminUserAdapter(this::confirmToggle);
        rvList.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvList.setAdapter(adapter);

        etSearch.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) { }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                query = s.toString().trim().toLowerCase(Locale.KOREA);
                renderFiltered();
            }

            @Override
            public void afterTextChanged(Editable s) { }
        });

        swipeRefresh.setOnRefreshListener(this::load);
        load();
    }

    private void load() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        apiService.listAdminUsers(1, 100).enqueue(new ApiCallback<PagedList<AdminUser>>() {
            @Override
            public void onSuccess(PagedList<AdminUser> data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                allUsers.clear();
                if (data != null && data.data != null) allUsers.addAll(data.data);
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
        List<AdminUser> filtered = new ArrayList<>();
        for (AdminUser user : allUsers) {
            if (query.isEmpty() || matches(user)) filtered.add(user);
        }
        tvEmpty.setVisibility(filtered.isEmpty() ? View.VISIBLE : View.GONE);
        adapter.setUsers(filtered);
    }

    private boolean matches(AdminUser user) {
        String name = user.displayName() != null ? user.displayName().toLowerCase(Locale.KOREA) : "";
        String email = user.email != null ? user.email.toLowerCase(Locale.KOREA) : "";
        return name.contains(query) || email.contains(query);
    }

    private void confirmToggle(AdminUser user) {
        String action = user.is_active ? "비활성화" : "활성화";
        new AlertDialog.Builder(requireContext())
                .setMessage(user.displayName() + " 계정을 " + action + "하시겠습니까?")
                .setPositiveButton(action, (dialog, which) -> toggleStatus(user))
                .setNegativeButton("취소", null)
                .show();
    }

    private void toggleStatus(AdminUser user) {
        boolean newActive = !user.is_active;
        apiService.updateUserStatus(user.id, new UpdateUserStatusRequest(newActive)).enqueue(new ApiCallback<MessageResponse>() {
            @Override
            public void onSuccess(MessageResponse data) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "상태가 변경되었습니다.", Toast.LENGTH_SHORT).show();
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

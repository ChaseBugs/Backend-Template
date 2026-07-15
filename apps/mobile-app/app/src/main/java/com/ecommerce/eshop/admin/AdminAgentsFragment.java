package com.ecommerce.eshop.admin;

import android.app.AlertDialog;
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
import com.ecommerce.eshop.model.AgentProfile;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.request.ApproveAgentRequest;
import com.ecommerce.eshop.model.request.ReasonRequest;

public class AdminAgentsFragment extends Fragment {

    private ApiService apiService;
    private PendingAgentAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_admin_agents, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        RecyclerView rvList = view.findViewById(R.id.rvList);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvEmpty = view.findViewById(R.id.tvEmpty);

        adapter = new PendingAgentAdapter(new PendingAgentAdapter.Listener() {
            @Override
            public void onApprove(AgentProfile agent) {
                approve(agent);
            }

            @Override
            public void onReject(AgentProfile agent) {
                promptReject(agent);
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
        apiService.listPendingAgents(1, 50).enqueue(new ApiCallback<PagedList<AgentProfile>>() {
            @Override
            public void onSuccess(PagedList<AgentProfile> data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                boolean empty = data == null || data.data == null || data.data.isEmpty();
                tvEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
                adapter.setAgents(data != null ? data.data : null);
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

    private void approve(AgentProfile agent) {
        apiService.approveAgent(agent.id, new ApproveAgentRequest(null)).enqueue(new ApiCallback<MessageResponse>() {
            @Override
            public void onSuccess(MessageResponse data) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "에이전트가 승인되었습니다.", Toast.LENGTH_SHORT).show();
                load();
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void promptReject(AgentProfile agent) {
        EditText input = new EditText(requireContext());
        input.setHint("거절 사유를 입력하세요");
        new AlertDialog.Builder(requireContext())
                .setTitle("에이전트 거절")
                .setView(input)
                .setPositiveButton("거절", (dialog, which) -> {
                    String reason = input.getText() != null ? input.getText().toString().trim() : "";
                    if (TextUtils.isEmpty(reason)) {
                        Toast.makeText(requireContext(), "거절 사유를 입력해주세요.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    reject(agent, reason);
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private void reject(AgentProfile agent, String reason) {
        apiService.rejectAgent(agent.id, new ReasonRequest(reason)).enqueue(new ApiCallback<MessageResponse>() {
            @Override
            public void onSuccess(MessageResponse data) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "에이전트가 거절되었습니다.", Toast.LENGTH_SHORT).show();
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

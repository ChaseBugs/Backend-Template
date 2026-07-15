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
import com.ecommerce.eshop.model.AgentProfile;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.request.ApproveAgentRequest;
import com.ecommerce.eshop.model.request.ReasonRequest;

import java.util.ArrayList;
import java.util.List;

/**
 * admin-service has no "list all agents" endpoint yet (only /agents/pending and a
 * per-agent stats lookup) — the 활성/정지 tabs below render prototype-faithful
 * placeholder rows matching the imported design's mockup content, not live data.
 * The 승인 대기 tab is fully real, backed by GET /agents/pending with working
 * approve/reject actions.
 */
public class AdminAgentsFragment extends Fragment {

    private static final int TAB_PENDING = 0;
    private static final int TAB_ACTIVE = 1;
    private static final int TAB_SUSPENDED = 2;
    private static final String[] FILTER_LABELS = {"승인 대기", "활성", "정지"};

    private ApiService apiService;
    private PendingAgentAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private LinearLayout filterChips;
    private int selectedTab = TAB_PENDING;

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
        filterChips = view.findViewById(R.id.filterChips);

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
                selectedTab = index;
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
            boolean selected = i == selectedTab;
            chip.setBackgroundResource(selected ? R.drawable.dash_chip_selected : R.drawable.dash_chip_unselected);
            chip.setTextColor(ContextCompat.getColor(requireContext(), selected ? R.color.white : R.color.dash_text_secondary));
        }
    }

    private void load() {
        if (!isAdded()) return;
        if (selectedTab != TAB_PENDING) {
            progressBar.setVisibility(View.GONE);
            swipeRefresh.setRefreshing(false);
            List<AgentProfile> placeholder = placeholderAgents(selectedTab);
            tvEmpty.setVisibility(View.GONE);
            adapter.setAgents(placeholder);
            return;
        }

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

    private List<AgentProfile> placeholderAgents(int tab) {
        List<AgentProfile> list = new ArrayList<>();
        String status = tab == TAB_ACTIVE ? "APPROVED" : "SUSPENDED";
        String[] names = tab == TAB_ACTIVE
                ? new String[]{"제이드 마켓", "브라이트 스토어", "노스 리빙"}
                : new String[]{"올드 트레이딩"};
        double[] commissions = tab == TAB_ACTIVE
                ? new double[]{8.0, 6.5, 10.0}
                : new double[]{7.0};
        for (int i = 0; i < names.length; i++) {
            AgentProfile agent = new AgentProfile();
            agent.id = "placeholder-" + tab + "-" + i;
            agent.businessName = names[i];
            agent.businessNumber = "000-00-0000" + i;
            agent.commissionRate = commissions[i];
            agent.approvalStatus = status;
            agent.createdAt = "—";
            list.add(agent);
        }
        return list;
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

    private int dp(int value) {
        float density = requireContext().getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }
}

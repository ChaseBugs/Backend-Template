package com.ecommerce.eshop.admin;

import android.os.Bundle;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.AgentStatusCount;
import com.ecommerce.eshop.model.DashboardSummary;
import com.ecommerce.eshop.model.StatusCount;

public class AdminHomeFragment extends Fragment {

    private ApiService apiService;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvTotalUsers;
    private TextView tvTotalAgents;
    private TextView tvTotalRevenue;
    private TextView tvPendingAgents;
    private LinearLayout ordersBarChart;
    private LinearLayout agentStatusList;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_admin_home, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvTotalUsers = view.findViewById(R.id.tvTotalUsers);
        tvTotalAgents = view.findViewById(R.id.tvTotalAgents);
        tvTotalRevenue = view.findViewById(R.id.tvTotalRevenue);
        tvPendingAgents = view.findViewById(R.id.tvPendingAgents);
        ordersBarChart = view.findViewById(R.id.ordersBarChart);
        agentStatusList = view.findViewById(R.id.agentStatusList);

        swipeRefresh.setOnRefreshListener(this::load);
        load();
    }

    private void load() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        apiService.getAdminDashboard().enqueue(new ApiCallback<DashboardSummary>() {
            @Override
            public void onSuccess(DashboardSummary data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                bind(data);
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

    private void bind(DashboardSummary data) {
        if (data == null) return;
        tvTotalUsers.setText(String.valueOf(data.totalUsers));
        tvTotalAgents.setText(String.valueOf(data.totalAgents()));
        tvTotalRevenue.setText(ProductAdapter.formatWon(data.totalRevenue));
        tvPendingAgents.setText(String.valueOf(data.agentCountByStatus("PENDING")));

        buildOrdersBarChart(data);
        buildAgentStatusList(data);
    }

    private void buildOrdersBarChart(DashboardSummary data) {
        ordersBarChart.removeAllViews();
        if (data.ordersByStatus == null || data.ordersByStatus.isEmpty()) return;

        int maxCount = 1;
        for (StatusCount row : data.ordersByStatus) {
            maxCount = Math.max(maxCount, parseCount(row.count));
        }

        int maxBarHeightPx = dpToPx(80);
        for (StatusCount row : data.ordersByStatus) {
            int count = parseCount(row.count);
            int barHeightPx = Math.max(dpToPx(4), (int) ((count / (float) maxCount) * maxBarHeightPx));

            LinearLayout column = new LinearLayout(requireContext());
            column.setOrientation(LinearLayout.VERTICAL);
            column.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
            LinearLayout.LayoutParams columnParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f);
            column.setLayoutParams(columnParams);

            TextView tvCount = new TextView(requireContext());
            tvCount.setText(String.valueOf(count));
            tvCount.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_text));
            tvCount.setTextSize(11);

            FrameLayout barSlot = new FrameLayout(requireContext());
            LinearLayout.LayoutParams slotParams = new LinearLayout.LayoutParams(dpToPx(24), maxBarHeightPx);
            slotParams.topMargin = dpToPx(2);
            barSlot.setLayoutParams(slotParams);

            View bar = new View(requireContext());
            FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(dpToPx(24), barHeightPx);
            barParams.gravity = Gravity.BOTTOM;
            bar.setLayoutParams(barParams);
            bar.setBackgroundResource(R.drawable.dash_bar_segment);
            barSlot.addView(bar);

            TextView tvLabel = new TextView(requireContext());
            tvLabel.setText(orderStatusLabel(row.status));
            tvLabel.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_text_secondary));
            tvLabel.setTextSize(9);
            tvLabel.setGravity(Gravity.CENTER_HORIZONTAL);
            tvLabel.setMaxLines(1);

            column.addView(tvCount);
            column.addView(barSlot);
            column.addView(tvLabel);
            ordersBarChart.addView(column);
        }
    }

    private void buildAgentStatusList(DashboardSummary data) {
        agentStatusList.removeAllViews();
        if (data.agentsByStatus == null || data.agentsByStatus.isEmpty()) return;

        for (AgentStatusCount row : data.agentsByStatus) {
            LinearLayout rowView = new LinearLayout(requireContext());
            rowView.setOrientation(LinearLayout.HORIZONTAL);
            rowView.setGravity(Gravity.CENTER_VERTICAL);
            rowView.setBackgroundResource(R.drawable.dash_card_bg);
            rowView.setPadding(dpToPx(14), dpToPx(12), dpToPx(14), dpToPx(12));

            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            rowParams.bottomMargin = dpToPx(8);
            rowView.setLayoutParams(rowParams);

            TextView tvLabel = new TextView(requireContext());
            tvLabel.setText(agentStatusLabel(row.approval_status));
            tvLabel.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_text));
            LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            tvLabel.setLayoutParams(labelParams);

            TextView tvCount = new TextView(requireContext());
            tvCount.setText(String.valueOf(parseCount(row.count)));
            tvCount.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_accent));
            tvCount.setTypeface(null, android.graphics.Typeface.BOLD);

            rowView.addView(tvLabel);
            rowView.addView(tvCount);
            agentStatusList.addView(rowView);
        }
    }

    private static int parseCount(String count) {
        try {
            return count != null ? Integer.parseInt(count) : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String orderStatusLabel(String status) {
        if (status == null) return "—";
        switch (status) {
            case "PENDING": return "대기";
            case "CONFIRMED": return "확정";
            case "PAYMENT_PENDING": return "결제대기";
            case "PAID": return "결제완료";
            case "SHIPPED": return "배송중";
            case "COMPLETED": return "완료";
            case "CANCELLED": return "취소";
            case "REFUNDED": return "환불";
            default: return status;
        }
    }

    private static String agentStatusLabel(String approvalStatus) {
        if (approvalStatus == null) return "—";
        switch (approvalStatus) {
            case "PENDING": return "승인 대기";
            case "APPROVED": return "활성 에이전트";
            case "REJECTED": return "거절됨";
            default: return approvalStatus;
        }
    }

    private int dpToPx(int dp) {
        float density = requireContext().getResources().getDisplayMetrics().density;
        return Math.round(dp * density);
    }
}

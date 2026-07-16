package com.ecommerce.eshop.agent;

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
import com.ecommerce.eshop.model.AgentSalesSummary;
import com.ecommerce.eshop.model.AgentSettlementSummary;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Map;

/**
 * 매출/정산 카드와 정산 상태 막대그래프는 실 데이터(GET /orders/agent/summary,
 * GET /payments/settlements/summary)로 채워진다. "상품별 수익"만 집계 API가 없어
 * 예시 수치로 남겨두었다 (화면 하단 안내 문구 참고).
 */
public class AgentEarningsFragment extends Fragment {

    private static final String[] PERIOD_LABELS = {"오늘", "이번 주", "이번 달"};
    private static final String[] PERIOD_TITLES = {"오늘 매출", "이번 주 매출", "이번 달 매출"};
    private static final long[] PERIOD_DAYS = {1, 7, 30};

    private static final String[] SETTLEMENT_STATUSES = {"PENDING", "PROCESSING", "COMPLETED", "HELD"};
    private static final String[] SETTLEMENT_LABELS = {"지급대기", "처리중", "지급완료", "보류"};

    private static final String[] PRODUCT_NAMES = {"무선 이어폰 프로", "미니멀 백팩", "스마트 워치 밴드"};
    private static final String[] PRODUCT_AMOUNTS = {"₩186,000", "₩94,200", "₩62,600"};

    private ApiService apiService;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private LinearLayout periodToggle;
    private TextView tvPeriodLabel;
    private TextView tvEarningsAmount;
    private TextView tvPeriodOrders;
    private LinearLayout settlementBarChart;
    private TextView tvPayoutPending;
    private TextView tvPaidOut;
    private TextView tvLifetimeCommission;
    private LinearLayout byProductList;
    private int selectedPeriod = 1;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_agent_earnings, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        periodToggle = view.findViewById(R.id.periodToggle);
        tvPeriodLabel = view.findViewById(R.id.tvPeriodLabel);
        tvEarningsAmount = view.findViewById(R.id.tvEarningsAmount);
        tvPeriodOrders = view.findViewById(R.id.tvPeriodOrders);
        settlementBarChart = view.findViewById(R.id.settlementBarChart);
        tvPayoutPending = view.findViewById(R.id.tvPayoutPending);
        tvPaidOut = view.findViewById(R.id.tvPaidOut);
        tvLifetimeCommission = view.findViewById(R.id.tvLifetimeCommission);
        byProductList = view.findViewById(R.id.byProductList);

        buildPeriodToggle();
        buildProductList();
        swipeRefresh.setOnRefreshListener(this::loadAll);
        loadAll();
    }

    private void loadAll() {
        applyPeriodStyles();
        loadSalesForPeriod();
        loadSettlement();
    }

    private void buildPeriodToggle() {
        periodToggle.removeAllViews();
        for (int i = 0; i < PERIOD_LABELS.length; i++) {
            int index = i;
            TextView tab = new TextView(requireContext());
            tab.setText(PERIOD_LABELS[i]);
            tab.setGravity(Gravity.CENTER);
            tab.setTextSize(13);
            tab.setPadding(0, dp(8), 0, dp(8));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            tab.setLayoutParams(params);
            tab.setOnClickListener(v -> {
                selectedPeriod = index;
                applyPeriodStyles();
                loadSalesForPeriod();
            });
            periodToggle.addView(tab);
        }
    }

    private void applyPeriodStyles() {
        for (int i = 0; i < periodToggle.getChildCount(); i++) {
            TextView tab = (TextView) periodToggle.getChildAt(i);
            boolean selected = i == selectedPeriod;
            tab.setBackgroundResource(selected ? R.drawable.dash_chip_selected : 0);
            tab.setTextColor(ContextCompat.getColor(requireContext(), selected ? R.color.white : R.color.dash_text_secondary));
        }
        tvPeriodLabel.setText(PERIOD_TITLES[selectedPeriod]);
    }

    private void loadSalesForPeriod() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        Instant to = Instant.now();
        Instant from = to.minus(PERIOD_DAYS[selectedPeriod], ChronoUnit.DAYS);
        String fromIso = DateTimeFormatter.ISO_INSTANT.format(from);
        String toIso = DateTimeFormatter.ISO_INSTANT.format(to);

        apiService.getAgentSalesSummary(fromIso, toIso).enqueue(new ApiCallback<AgentSalesSummary>() {
            @Override
            public void onSuccess(AgentSalesSummary data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                if (data != null && data.totals != null) {
                    tvEarningsAmount.setText(ProductAdapter.formatWon(data.totals.grossSales));
                    tvPeriodOrders.setText("주문 " + data.totals.orderCount + "건 · 판매 " + data.totals.unitsSold + "개");
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

    private void loadSettlement() {
        if (!isAdded()) return;
        apiService.getAgentSettlementSummary().enqueue(new ApiCallback<AgentSettlementSummary>() {
            @Override
            public void onSuccess(AgentSettlementSummary data) {
                if (!isAdded()) return;
                if (data != null) {
                    tvPayoutPending.setText(ProductAdapter.formatWon(data.payoutPending));
                    tvPaidOut.setText(ProductAdapter.formatWon(data.paidOut));
                    tvLifetimeCommission.setText(ProductAdapter.formatWon(data.lifetimeCommission));
                    buildSettlementBarChart(data.byStatus);
                }
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void buildSettlementBarChart(Map<String, AgentSettlementSummary.StatusBreakdown> byStatus) {
        settlementBarChart.removeAllViews();
        if (byStatus == null) return;

        int maxCount = 1;
        for (String status : SETTLEMENT_STATUSES) {
            AgentSettlementSummary.StatusBreakdown row = byStatus.get(status);
            if (row != null) maxCount = Math.max(maxCount, row.count);
        }

        int maxBarHeightPx = dp(80);
        for (int i = 0; i < SETTLEMENT_STATUSES.length; i++) {
            AgentSettlementSummary.StatusBreakdown row = byStatus.get(SETTLEMENT_STATUSES[i]);
            int count = row != null ? row.count : 0;
            int barHeightPx = count == 0 ? 0 : Math.max(dp(4), (int) ((count / (float) maxCount) * maxBarHeightPx));

            LinearLayout column = new LinearLayout(requireContext());
            column.setOrientation(LinearLayout.VERTICAL);
            column.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
            column.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

            TextView tvCount = new TextView(requireContext());
            tvCount.setText(String.valueOf(count));
            tvCount.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_text));
            tvCount.setTextSize(11);

            FrameLayout barSlot = new FrameLayout(requireContext());
            LinearLayout.LayoutParams slotParams = new LinearLayout.LayoutParams(dp(24), maxBarHeightPx);
            slotParams.topMargin = dp(2);
            barSlot.setLayoutParams(slotParams);

            View bar = new View(requireContext());
            FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(dp(24), barHeightPx);
            barParams.gravity = Gravity.BOTTOM;
            bar.setLayoutParams(barParams);
            bar.setBackgroundResource(R.drawable.dash_bar_segment);
            barSlot.addView(bar);

            TextView tvLabel = new TextView(requireContext());
            tvLabel.setText(SETTLEMENT_LABELS[i]);
            tvLabel.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_text_secondary));
            tvLabel.setTextSize(10);
            tvLabel.setGravity(Gravity.CENTER_HORIZONTAL);

            column.addView(tvCount);
            column.addView(barSlot);
            column.addView(tvLabel);
            settlementBarChart.addView(column);
        }
    }

    private void buildProductList() {
        byProductList.removeAllViews();
        for (int i = 0; i < PRODUCT_NAMES.length; i++) {
            LinearLayout row = new LinearLayout(requireContext());
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setBackgroundResource(R.drawable.dash_card_bg);
            row.setPadding(dp(14), dp(12), dp(14), dp(12));
            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            rowParams.bottomMargin = dp(8);
            row.setLayoutParams(rowParams);

            TextView tvName = new TextView(requireContext());
            tvName.setText(PRODUCT_NAMES[i]);
            tvName.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_text));
            tvName.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            TextView tvAmount = new TextView(requireContext());
            tvAmount.setText(PRODUCT_AMOUNTS[i]);
            tvAmount.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_accent));
            tvAmount.setTypeface(null, android.graphics.Typeface.BOLD);

            row.addView(tvName);
            row.addView(tvAmount);
            byProductList.addView(row);
        }
    }

    private int dp(int value) {
        float density = requireContext().getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }
}

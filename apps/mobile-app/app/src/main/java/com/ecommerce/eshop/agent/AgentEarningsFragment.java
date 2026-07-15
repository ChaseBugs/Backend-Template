package com.ecommerce.eshop.agent;

import android.os.Bundle;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.ecommerce.eshop.R;

/**
 * Prototype-faithful earnings screen: no settlement/analytics endpoint is wired here,
 * every figure below is a static display value matching the imported design's mockup content.
 */
public class AgentEarningsFragment extends Fragment {

    private static final String[] PERIOD_LABELS = {"오늘", "이번 주", "이번 달"};
    private static final String[] PERIOD_TITLES = {"오늘 수익", "이번 주 수익", "이번 달 수익"};
    private static final String[] PERIOD_AMOUNTS = {"₩58,400", "₩342,800", "₩1,284,000"};
    private static final String[] PERIOD_DELTAS = {"전일 대비 +6%", "전주 대비 +12%", "전달 대비 +18%"};
    private static final int[] BAR_HEIGHTS_DP = {40, 65, 30, 80, 55, 90, 70};
    private static final String[] BAR_LABELS = {"월", "화", "수", "목", "금", "토", "일"};

    private static final String[] PRODUCT_NAMES = {"무선 이어폰 프로", "미니멀 백팩", "스마트 워치 밴드"};
    private static final String[] PRODUCT_AMOUNTS = {"₩186,000", "₩94,200", "₩62,600"};

    private LinearLayout periodToggle;
    private TextView tvPeriodLabel;
    private TextView tvEarningsAmount;
    private LinearLayout earningsBarChart;
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

        periodToggle = view.findViewById(R.id.periodToggle);
        tvPeriodLabel = view.findViewById(R.id.tvPeriodLabel);
        tvEarningsAmount = view.findViewById(R.id.tvEarningsAmount);
        earningsBarChart = view.findViewById(R.id.earningsBarChart);
        byProductList = view.findViewById(R.id.byProductList);

        buildPeriodToggle();
        buildBarChart();
        buildProductList();
        applyPeriod();
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
                applyPeriod();
            });
            periodToggle.addView(tab);
        }
    }

    private void applyPeriod() {
        for (int i = 0; i < periodToggle.getChildCount(); i++) {
            TextView tab = (TextView) periodToggle.getChildAt(i);
            boolean selected = i == selectedPeriod;
            tab.setBackgroundResource(selected ? R.drawable.dash_chip_selected : 0);
            tab.setTextColor(ContextCompat.getColor(requireContext(), selected ? R.color.white : R.color.dash_text_secondary));
        }
        tvPeriodLabel.setText(PERIOD_TITLES[selectedPeriod]);
        tvEarningsAmount.setText(PERIOD_AMOUNTS[selectedPeriod]);
    }

    private void buildBarChart() {
        earningsBarChart.removeAllViews();
        int maxHeightDp = 90;
        for (int i = 0; i < BAR_HEIGHTS_DP.length; i++) {
            LinearLayout column = new LinearLayout(requireContext());
            column.setOrientation(LinearLayout.VERTICAL);
            column.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
            column.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

            FrameLayout barSlot = new FrameLayout(requireContext());
            barSlot.setLayoutParams(new LinearLayout.LayoutParams(dp(18), dp(maxHeightDp)));

            View bar = new View(requireContext());
            FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(dp(18), dp(BAR_HEIGHTS_DP[i]));
            barParams.gravity = Gravity.BOTTOM;
            bar.setLayoutParams(barParams);
            bar.setBackgroundResource(R.drawable.dash_bar_segment);
            barSlot.addView(bar);

            TextView tvLabel = new TextView(requireContext());
            tvLabel.setText(BAR_LABELS[i]);
            tvLabel.setTextColor(ContextCompat.getColor(requireContext(), R.color.dash_text_secondary));
            tvLabel.setTextSize(10);
            tvLabel.setGravity(Gravity.CENTER_HORIZONTAL);

            column.addView(barSlot);
            column.addView(tvLabel);
            earningsBarChart.addView(column);
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

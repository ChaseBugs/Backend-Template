package com.ecommerce.eshop.agent;

import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
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
import com.ecommerce.eshop.model.AdCampaign;
import com.ecommerce.eshop.model.PagedList;

import java.util.HashMap;

public class AgentAdsFragment extends Fragment {

    private static final String[] FILTER_LABELS = {"전체", "승인 대기", "진행중", "일시정지", "거절됨", "예산 소진"};
    private static final String[] FILTER_STATUSES = {null, "PENDING_APPROVAL", "ACTIVE", "PAUSED", "REJECTED", "COMPLETED"};

    private ApiService apiService;
    private AdCampaignAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private LinearLayout filterChips;
    private int selectedFilter = 0;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_agent_ads, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        apiService = ApiClient.getApiService(requireContext());

        RecyclerView rvCampaigns = view.findViewById(R.id.rvCampaigns);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        progressBar = view.findViewById(R.id.progressBar);
        tvEmpty = view.findViewById(R.id.tvEmpty);
        filterChips = view.findViewById(R.id.filterChips);
        Button btnCreateCampaign = view.findViewById(R.id.btnCreateCampaign);

        adapter = new AdCampaignAdapter(new AdCampaignAdapter.Listener() {
            @Override
            public void onPause(AdCampaign campaign) {
                pauseCampaign(campaign);
            }

            @Override
            public void onResume(AdCampaign campaign) {
                resumeCampaign(campaign);
            }
        });
        rvCampaigns.setLayoutManager(new LinearLayoutManager(requireContext()));
        rvCampaigns.setAdapter(adapter);

        buildFilterChips();
        swipeRefresh.setOnRefreshListener(this::load);
        btnCreateCampaign.setOnClickListener(v -> startActivity(new Intent(requireContext(), AgentAdCreateActivity.class)));

        load();
    }

    @Override
    public void onResume() {
        super.onResume();
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
                selectedFilter = index;
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
            boolean selected = i == selectedFilter;
            chip.setBackgroundResource(selected ? R.drawable.dash_chip_selected : R.drawable.dash_chip_unselected);
            chip.setTextColor(ContextCompat.getColor(requireContext(), selected ? R.color.white : R.color.dash_text_secondary));
        }
    }

    private void load() {
        if (!isAdded()) return;
        progressBar.setVisibility(View.VISIBLE);
        String status = FILTER_STATUSES[selectedFilter];
        apiService.listMyAdCampaigns(1, 50, status).enqueue(new ApiCallback<PagedList<AdCampaign>>() {
            @Override
            public void onSuccess(PagedList<AdCampaign> data) {
                if (!isAdded()) return;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                boolean empty = data == null || data.data == null || data.data.isEmpty();
                tvEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
                adapter.setCampaigns(data != null ? data.data : null);
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

    private void pauseCampaign(AdCampaign campaign) {
        apiService.pauseAdCampaign(campaign.id, new HashMap<>()).enqueue(new ApiCallback<AdCampaign>() {
            @Override
            public void onSuccess(AdCampaign data) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "캠페인을 일시정지했습니다.", Toast.LENGTH_SHORT).show();
                load();
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "오류: " + message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void resumeCampaign(AdCampaign campaign) {
        apiService.resumeAdCampaign(campaign.id, new HashMap<>()).enqueue(new ApiCallback<AdCampaign>() {
            @Override
            public void onSuccess(AdCampaign data) {
                if (!isAdded()) return;
                Toast.makeText(requireContext(), "캠페인을 재개했습니다.", Toast.LENGTH_SHORT).show();
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

package com.ecommerce.eshop.agent;

import android.content.res.ColorStateList;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.AdCampaign;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class AdCampaignAdapter extends RecyclerView.Adapter<AdCampaignAdapter.ViewHolder> {

    public interface Listener {
        void onPause(AdCampaign campaign);
        void onResume(AdCampaign campaign);
    }

    private final List<AdCampaign> campaigns = new ArrayList<>();
    private final Listener listener;

    public AdCampaignAdapter(Listener listener) {
        this.listener = listener;
    }

    public void setCampaigns(List<AdCampaign> newCampaigns) {
        campaigns.clear();
        if (newCampaigns != null) campaigns.addAll(newCampaigns);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_ad_campaign, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        AdCampaign campaign = campaigns.get(position);
        holder.tvProductId.setText("상품 #" + shortId(campaign.productId));
        holder.tvStatus.setText(campaign.status);
        holder.tvStatus.setBackgroundTintList(ColorStateList.valueOf(
                ContextCompat.getColor(holder.itemView.getContext(), colorForStatus(campaign.status))));
        holder.tvBudget.setText(String.format(Locale.KOREA, "CPC %s · 일예산 %s · 총예산 %s",
                ProductAdapter.formatWon(campaign.costPerClick), ProductAdapter.formatWon(campaign.dailyBudget), ProductAdapter.formatWon(campaign.totalBudget)));
        holder.tvStats.setText(String.format(Locale.KOREA, "노출 %d · 클릭 %d (CTR %.2f%%) · 누적지출 %s",
                campaign.impressionCount, campaign.clickCount, campaign.ctr(), ProductAdapter.formatWon(campaign.spentTotal)));

        if ("REJECTED".equals(campaign.status) && campaign.rejectionReason != null) {
            holder.tvRejectionReason.setText("거절 사유: " + campaign.rejectionReason);
            holder.tvRejectionReason.setVisibility(View.VISIBLE);
        } else {
            holder.tvRejectionReason.setVisibility(View.GONE);
        }

        boolean canPause = "ACTIVE".equals(campaign.status);
        boolean canResume = "PAUSED".equals(campaign.status);
        holder.actionRow.setVisibility(canPause || canResume ? View.VISIBLE : View.GONE);
        holder.btnPause.setVisibility(canPause ? View.VISIBLE : View.GONE);
        holder.btnResume.setVisibility(canResume ? View.VISIBLE : View.GONE);
        holder.btnPause.setOnClickListener(v -> {
            if (listener != null) listener.onPause(campaign);
        });
        holder.btnResume.setOnClickListener(v -> {
            if (listener != null) listener.onResume(campaign);
        });
    }

    @Override
    public int getItemCount() {
        return campaigns.size();
    }

    private static String shortId(String id) {
        if (id == null) return "—";
        return id.length() > 8 ? id.substring(0, 8) : id;
    }

    private static int colorForStatus(String status) {
        if (status == null) return R.color.dash_accent;
        switch (status) {
            case "ACTIVE": return R.color.dash_success;
            case "REJECTED": return R.color.dash_danger;
            case "PENDING_APPROVAL": return R.color.dash_warning;
            case "PAUSED":
            case "COMPLETED":
                return R.color.dash_neutral_800;
            default: return R.color.dash_accent;
        }
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvProductId;
        final TextView tvStatus;
        final TextView tvBudget;
        final TextView tvStats;
        final TextView tvRejectionReason;
        final ViewGroup actionRow;
        final Button btnPause;
        final Button btnResume;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvProductId = itemView.findViewById(R.id.tvProductId);
            tvStatus = itemView.findViewById(R.id.tvStatus);
            tvBudget = itemView.findViewById(R.id.tvBudget);
            tvStats = itemView.findViewById(R.id.tvStats);
            tvRejectionReason = itemView.findViewById(R.id.tvRejectionReason);
            actionRow = itemView.findViewById(R.id.actionRow);
            btnPause = itemView.findViewById(R.id.btnPause);
            btnResume = itemView.findViewById(R.id.btnResume);
        }
    }
}

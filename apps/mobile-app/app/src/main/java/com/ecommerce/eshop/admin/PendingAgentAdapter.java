package com.ecommerce.eshop.admin;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.model.AgentProfile;

import java.util.ArrayList;
import java.util.List;

public class PendingAgentAdapter extends RecyclerView.Adapter<PendingAgentAdapter.ViewHolder> {

    public interface Listener {
        void onApprove(AgentProfile agent);
        void onReject(AgentProfile agent);
    }

    private final List<AgentProfile> agents = new ArrayList<>();
    private final Listener listener;

    public PendingAgentAdapter(Listener listener) {
        this.listener = listener;
    }

    public void setAgents(List<AgentProfile> newAgents) {
        agents.clear();
        if (newAgents != null) agents.addAll(newAgents);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_pending_agent, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        AgentProfile agent = agents.get(position);
        holder.tvBusinessName.setText(agent.businessName);
        holder.tvBusinessNumber.setText("사업자번호: " + agent.businessNumber);
        holder.tvCommission.setText("수수료: " + agent.commissionRate + "%");
        holder.tvAppliedAt.setText("신청일: " + (agent.createdAt != null ? agent.createdAt : "—"));

        String status = agent.approvalStatus != null ? agent.approvalStatus : "PENDING";
        holder.tvApprovalStatus.setText(status);
        holder.tvApprovalStatus.setBackgroundTintList(android.content.res.ColorStateList.valueOf(
                ContextCompat.getColor(holder.itemView.getContext(), colorForStatus(status))));

        boolean pending = "PENDING".equals(status);
        holder.approvalActions.setVisibility(pending ? View.VISIBLE : View.GONE);
        holder.btnApprove.setOnClickListener(v -> {
            if (listener != null) listener.onApprove(agent);
        });
        holder.btnReject.setOnClickListener(v -> {
            if (listener != null) listener.onReject(agent);
        });
    }

    private static int colorForStatus(String status) {
        switch (status) {
            case "APPROVED": return R.color.dash_success;
            case "SUSPENDED": return R.color.dash_neutral_800;
            case "REJECTED": return R.color.dash_danger;
            default: return R.color.dash_warning;
        }
    }

    @Override
    public int getItemCount() {
        return agents.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvBusinessName;
        final TextView tvApprovalStatus;
        final TextView tvBusinessNumber;
        final TextView tvCommission;
        final TextView tvAppliedAt;
        final ViewGroup approvalActions;
        final Button btnApprove;
        final Button btnReject;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvBusinessName = itemView.findViewById(R.id.tvBusinessName);
            tvApprovalStatus = itemView.findViewById(R.id.tvApprovalStatus);
            tvBusinessNumber = itemView.findViewById(R.id.tvBusinessNumber);
            tvCommission = itemView.findViewById(R.id.tvCommission);
            tvAppliedAt = itemView.findViewById(R.id.tvAppliedAt);
            approvalActions = itemView.findViewById(R.id.approvalActions);
            btnApprove = itemView.findViewById(R.id.btnApprove);
            btnReject = itemView.findViewById(R.id.btnReject);
        }
    }
}

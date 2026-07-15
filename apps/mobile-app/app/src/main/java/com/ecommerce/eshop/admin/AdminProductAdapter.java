package com.ecommerce.eshop.admin;

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
import com.ecommerce.eshop.model.AdminProduct;

import java.util.ArrayList;
import java.util.List;

public class AdminProductAdapter extends RecyclerView.Adapter<AdminProductAdapter.ViewHolder> {

    public interface Listener {
        void onApprove(AdminProduct product);
        void onReject(AdminProduct product);
    }

    private final List<AdminProduct> products = new ArrayList<>();
    private final Listener listener;

    public AdminProductAdapter(Listener listener) {
        this.listener = listener;
    }

    public void setProducts(List<AdminProduct> newProducts) {
        products.clear();
        if (newProducts != null) products.addAll(newProducts);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_admin_product, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        AdminProduct product = products.get(position);
        holder.tvName.setText(product.name);
        holder.tvStatus.setText(product.status);
        holder.tvStatus.setBackgroundTintList(ColorStateList.valueOf(
                ContextCompat.getColor(holder.itemView.getContext(), colorForStatus(product.status))));
        holder.tvAgentName.setText("판매: " + (product.agent_name != null ? product.agent_name : "—"));
        holder.tvPrice.setText(ProductAdapter.formatWon(product.price));

        if (product.quantity_available != null) {
            holder.tvStock.setText("재고: " + product.quantity_available + (product.lowStock() ? " (부족)" : ""));
            holder.tvStock.setVisibility(View.VISIBLE);
        } else {
            holder.tvStock.setVisibility(View.GONE);
        }

        boolean pending = "PENDING_APPROVAL".equals(product.status);
        holder.moderationActions.setVisibility(pending ? View.VISIBLE : View.GONE);
        holder.btnApprove.setOnClickListener(v -> {
            if (listener != null) listener.onApprove(product);
        });
        holder.btnReject.setOnClickListener(v -> {
            if (listener != null) listener.onReject(product);
        });
    }

    @Override
    public int getItemCount() {
        return products.size();
    }

    private static int colorForStatus(String status) {
        if (status == null) return R.color.dash_accent;
        switch (status) {
            case "ACTIVE": return R.color.dash_success;
            case "REJECTED": return R.color.dash_danger;
            case "PENDING_APPROVAL": return R.color.dash_warning;
            case "INACTIVE": return R.color.dash_neutral_800;
            default: return R.color.dash_accent;
        }
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvName;
        final TextView tvStatus;
        final TextView tvAgentName;
        final TextView tvPrice;
        final TextView tvStock;
        final ViewGroup moderationActions;
        final Button btnApprove;
        final Button btnReject;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvName = itemView.findViewById(R.id.tvName);
            tvStatus = itemView.findViewById(R.id.tvStatus);
            tvAgentName = itemView.findViewById(R.id.tvAgentName);
            tvPrice = itemView.findViewById(R.id.tvPrice);
            tvStock = itemView.findViewById(R.id.tvStock);
            moderationActions = itemView.findViewById(R.id.moderationActions);
            btnApprove = itemView.findViewById(R.id.btnApprove);
            btnReject = itemView.findViewById(R.id.btnReject);
        }
    }
}

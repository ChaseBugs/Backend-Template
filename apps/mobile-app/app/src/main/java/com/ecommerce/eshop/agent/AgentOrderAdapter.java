package com.ecommerce.eshop.agent;

import android.content.res.ColorStateList;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.Order;
import com.ecommerce.eshop.model.OrderItem;

import java.util.ArrayList;
import java.util.List;

public class AgentOrderAdapter extends RecyclerView.Adapter<AgentOrderAdapter.ViewHolder> {

    private final List<Order> orders = new ArrayList<>();

    public void setOrders(List<Order> newOrders) {
        orders.clear();
        if (newOrders != null) orders.addAll(newOrders);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_agent_order, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Order order = orders.get(position);
        holder.tvOrderId.setText("주문 #" + shortId(order.id) + " · 구매자 " + shortId(order.userId));
        holder.tvDate.setText(order.createdAt != null ? order.createdAt : "");
        holder.tvStatus.setText(order.status);
        holder.tvStatus.setBackgroundTintList(ColorStateList.valueOf(
                ContextCompat.getColor(holder.itemView.getContext(), colorForStatus(order.status))));
        holder.tvTotal.setText("합계 " + ProductAdapter.formatWon(order.totalAmount));

        holder.itemsContainer.removeAllViews();
        if (order.items != null) {
            for (OrderItem item : order.items) {
                TextView row = new TextView(holder.itemView.getContext());
                row.setText("• " + item.productName + " × " + item.quantity + " — " + ProductAdapter.formatWon(item.subtotal));
                row.setTextColor(ContextCompat.getColor(holder.itemView.getContext(), R.color.dash_text_secondary));
                row.setTextSize(12);
                holder.itemsContainer.addView(row);
            }
        }
    }

    @Override
    public int getItemCount() {
        return orders.size();
    }

    private static String shortId(String id) {
        if (id == null) return "—";
        return id.length() > 8 ? id.substring(0, 8) : id;
    }

    private static int colorForStatus(String status) {
        if (status == null) return R.color.dash_accent;
        switch (status) {
            case "COMPLETED":
            case "PAID":
                return R.color.dash_success;
            case "CANCELLED":
            case "REFUNDED":
                return R.color.dash_danger;
            case "PENDING":
            case "PAYMENT_PENDING":
                return R.color.dash_warning;
            default:
                return R.color.dash_accent;
        }
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvOrderId;
        final TextView tvDate;
        final TextView tvStatus;
        final TextView tvTotal;
        final LinearLayout itemsContainer;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvOrderId = itemView.findViewById(R.id.tvOrderId);
            tvDate = itemView.findViewById(R.id.tvDate);
            tvStatus = itemView.findViewById(R.id.tvStatus);
            tvTotal = itemView.findViewById(R.id.tvTotal);
            itemsContainer = itemView.findViewById(R.id.itemsContainer);
        }
    }
}

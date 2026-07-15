package com.ecommerce.eshop.orders;

import android.graphics.Color;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.Order;
import com.ecommerce.eshop.model.OrderItem;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class OrderAdapter extends RecyclerView.Adapter<OrderAdapter.ViewHolder> {

    public interface Listener {
        void onCancel(Order order);
    }

    private static final Set<String> CANCELLABLE = new HashSet<>();
    static {
        CANCELLABLE.add("PENDING");
        CANCELLABLE.add("CONFIRMED");
    }

    private final List<Order> orders = new ArrayList<>();
    private final Listener listener;

    public OrderAdapter(Listener listener) {
        this.listener = listener;
    }

    public void setOrders(List<Order> newOrders) {
        orders.clear();
        if (newOrders != null) orders.addAll(newOrders);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_order, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Order order = orders.get(position);
        holder.tvOrderId.setText("주문 #" + shortId(order.id));
        holder.tvDate.setText(order.createdAt != null ? order.createdAt : "");
        holder.tvStatus.setText(order.status);
        holder.tvStatus.setBackgroundTintList(android.content.res.ColorStateList.valueOf(colorForStatus(order.status)));
        holder.tvTotal.setText("합계 " + ProductAdapter.formatWon(order.totalAmount));

        holder.itemsContainer.removeAllViews();
        if (order.items != null) {
            for (OrderItem item : order.items) {
                TextView row = new TextView(holder.itemView.getContext());
                row.setText("• " + item.productName + " × " + item.quantity + " — " + ProductAdapter.formatWon(item.subtotal));
                row.setTextColor(holder.itemView.getContext().getResources().getColor(R.color.slate_500));
                row.setTextSize(12);
                holder.itemsContainer.addView(row);
            }
        }

        boolean cancellable = CANCELLABLE.contains(order.status);
        holder.btnCancel.setVisibility(cancellable ? View.VISIBLE : View.GONE);
        holder.btnCancel.setOnClickListener(v -> {
            if (listener != null) listener.onCancel(order);
        });
    }

    @Override
    public int getItemCount() {
        return orders.size();
    }

    private static String shortId(String id) {
        if (id == null) return "";
        return id.length() > 8 ? id.substring(0, 8) : id;
    }

    private static int colorForStatus(String status) {
        if (status == null) return Color.parseColor("#F1F5F9");
        switch (status) {
            case "COMPLETED":
            case "DELIVERED":
                return Color.parseColor("#D1FAE5");
            case "PENDING":
            case "PAYMENT_PENDING":
                return Color.parseColor("#FEF3C7");
            case "CANCELLED":
            case "FAILED":
                return Color.parseColor("#FFE4E6");
            case "SHIPPED":
            case "PAID":
            case "CONFIRMED":
                return Color.parseColor("#E0F2FE");
            default:
                return Color.parseColor("#F1F5F9");
        }
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvOrderId;
        final TextView tvDate;
        final TextView tvStatus;
        final TextView tvTotal;
        final LinearLayout itemsContainer;
        final Button btnCancel;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvOrderId = itemView.findViewById(R.id.tvOrderId);
            tvDate = itemView.findViewById(R.id.tvDate);
            tvStatus = itemView.findViewById(R.id.tvStatus);
            tvTotal = itemView.findViewById(R.id.tvTotal);
            itemsContainer = itemView.findViewById(R.id.itemsContainer);
            btnCancel = itemView.findViewById(R.id.btnCancel);
        }
    }
}

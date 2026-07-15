package com.ecommerce.eshop.admin;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.Product;

import java.util.ArrayList;
import java.util.List;

public class PendingProductAdapter extends RecyclerView.Adapter<PendingProductAdapter.ViewHolder> {

    public interface Listener {
        void onApprove(Product product);
        void onReject(Product product);
        void onView(Product product);
    }

    private final List<Product> products = new ArrayList<>();
    private final Listener listener;

    public PendingProductAdapter(Listener listener) {
        this.listener = listener;
    }

    public void setProducts(List<Product> newProducts) {
        products.clear();
        if (newProducts != null) products.addAll(newProducts);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_pending_product, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Product product = products.get(position);
        holder.tvName.setText(product.name);
        holder.tvPrice.setText("가격: " + ProductAdapter.formatWon(product.price));
        holder.tvCreatedAt.setText("등록일: " + (product.createdAt != null ? product.createdAt : "—"));

        holder.btnApprove.setOnClickListener(v -> {
            if (listener != null) listener.onApprove(product);
        });
        holder.btnReject.setOnClickListener(v -> {
            if (listener != null) listener.onReject(product);
        });
        holder.btnView.setOnClickListener(v -> {
            if (listener != null) listener.onView(product);
        });
    }

    @Override
    public int getItemCount() {
        return products.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvName;
        final TextView tvPrice;
        final TextView tvCreatedAt;
        final Button btnApprove;
        final Button btnReject;
        final Button btnView;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvName = itemView.findViewById(R.id.tvName);
            tvPrice = itemView.findViewById(R.id.tvPrice);
            tvCreatedAt = itemView.findViewById(R.id.tvCreatedAt);
            btnApprove = itemView.findViewById(R.id.btnApprove);
            btnReject = itemView.findViewById(R.id.btnReject);
            btnView = itemView.findViewById(R.id.btnView);
        }
    }
}

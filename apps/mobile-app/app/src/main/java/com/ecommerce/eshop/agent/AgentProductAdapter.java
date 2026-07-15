package com.ecommerce.eshop.agent;

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

public class AgentProductAdapter extends RecyclerView.Adapter<AgentProductAdapter.ViewHolder> {

    public interface Listener {
        void onView(Product product);
        void onDelete(Product product);
    }

    private final List<Product> products = new ArrayList<>();
    private final Listener listener;

    public AgentProductAdapter(Listener listener) {
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
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_agent_product, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Product product = products.get(position);
        holder.tvName.setText(product.name);
        holder.tvStatus.setText(product.status);
        holder.tvPrice.setText(ProductAdapter.formatWon(product.price));

        if ("REJECTED".equals(product.status) && product.rejectionReason != null) {
            holder.tvRejectionReason.setText("거절 사유: " + product.rejectionReason);
            holder.tvRejectionReason.setVisibility(View.VISIBLE);
        } else {
            holder.tvRejectionReason.setVisibility(View.GONE);
        }

        holder.btnView.setOnClickListener(v -> {
            if (listener != null) listener.onView(product);
        });
        holder.btnDelete.setOnClickListener(v -> {
            if (listener != null) listener.onDelete(product);
        });
    }

    @Override
    public int getItemCount() {
        return products.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvName;
        final TextView tvStatus;
        final TextView tvPrice;
        final TextView tvRejectionReason;
        final Button btnView;
        final Button btnDelete;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvName = itemView.findViewById(R.id.tvName);
            tvStatus = itemView.findViewById(R.id.tvStatus);
            tvPrice = itemView.findViewById(R.id.tvPrice);
            tvRejectionReason = itemView.findViewById(R.id.tvRejectionReason);
            btnView = itemView.findViewById(R.id.btnView);
            btnDelete = itemView.findViewById(R.id.btnDelete);
        }
    }
}

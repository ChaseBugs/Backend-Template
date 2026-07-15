package com.ecommerce.eshop.home;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.model.Product;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class ProductAdapter extends RecyclerView.Adapter<ProductAdapter.ViewHolder> {

    public interface OnProductClickListener {
        void onProductClick(Product product);
    }

    private final List<Product> products = new ArrayList<>();
    private final OnProductClickListener listener;

    public ProductAdapter(OnProductClickListener listener) {
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
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_product, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Product product = products.get(position);
        holder.tvName.setText(product.name);
        holder.tvAgent.setText("판매: " + (product.agentName != null ? product.agentName : "—"));
        holder.tvPrice.setText(formatWon(product.price));
        holder.tvEmoji.setText(emojiFor(product.categoryName));

        if (product.stock == null || product.stock > 0) {
            holder.tvStock.setText(product.stock != null ? ("재고 " + product.stock + "개") : "");
        } else {
            holder.tvStock.setText("품절");
        }

        holder.itemView.setOnClickListener(v -> {
            if (listener != null) listener.onProductClick(product);
        });
    }

    @Override
    public int getItemCount() {
        return products.size();
    }

    public static String formatWon(double price) {
        NumberFormat nf = NumberFormat.getNumberInstance(Locale.KOREA);
        return nf.format(price) + "원";
    }

    public static String emojiFor(String categoryName) {
        if (categoryName == null) return "📦";
        switch (categoryName) {
            case "전자제품": return "📱";
            case "의류": return "👗";
            case "식품": return "🥜";
            default: return "📦";
        }
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvEmoji;
        final TextView tvName;
        final TextView tvAgent;
        final TextView tvPrice;
        final TextView tvStock;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvEmoji = itemView.findViewById(R.id.tvEmoji);
            tvName = itemView.findViewById(R.id.tvName);
            tvAgent = itemView.findViewById(R.id.tvAgent);
            tvPrice = itemView.findViewById(R.id.tvPrice);
            tvStock = itemView.findViewById(R.id.tvStock);
        }
    }
}

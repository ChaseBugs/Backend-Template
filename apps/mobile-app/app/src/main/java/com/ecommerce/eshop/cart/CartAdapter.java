package com.ecommerce.eshop.cart;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.CartItem;

import java.util.ArrayList;
import java.util.List;

public class CartAdapter extends RecyclerView.Adapter<CartAdapter.ViewHolder> {

    public interface Listener {
        void onQuantityChange(CartItem item, int newQuantity);
        void onRemove(CartItem item);
    }

    private final List<CartItem> items = new ArrayList<>();
    private final Listener listener;

    public CartAdapter(Listener listener) {
        this.listener = listener;
    }

    public void setItems(List<CartItem> newItems) {
        items.clear();
        if (newItems != null) items.addAll(newItems);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_cart, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        CartItem item = items.get(position);
        holder.tvName.setText(item.productName);
        holder.tvPriceQty.setText(ProductAdapter.formatWon(item.unitPrice) + " × " + item.quantity + "개 = "
                + ProductAdapter.formatWon(item.subtotal()));
        holder.tvQty.setText(String.valueOf(item.quantity));

        holder.btnMinus.setOnClickListener(v -> {
            if (listener != null) listener.onQuantityChange(item, item.quantity - 1);
        });
        holder.btnPlus.setOnClickListener(v -> {
            if (listener != null) listener.onQuantityChange(item, item.quantity + 1);
        });
        holder.btnRemove.setOnClickListener(v -> {
            if (listener != null) listener.onRemove(item);
        });
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvName;
        final TextView tvPriceQty;
        final TextView tvQty;
        final android.widget.Button btnMinus;
        final android.widget.Button btnPlus;
        final android.widget.Button btnRemove;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvName = itemView.findViewById(R.id.tvName);
            tvPriceQty = itemView.findViewById(R.id.tvPriceQty);
            tvQty = itemView.findViewById(R.id.tvQty);
            btnMinus = itemView.findViewById(R.id.btnMinus);
            btnPlus = itemView.findViewById(R.id.btnPlus);
            btnRemove = itemView.findViewById(R.id.btnRemove);
        }
    }
}

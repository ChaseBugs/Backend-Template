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
import com.ecommerce.eshop.model.AdminUser;

import java.util.ArrayList;
import java.util.List;

public class AdminUserAdapter extends RecyclerView.Adapter<AdminUserAdapter.ViewHolder> {

    public interface Listener {
        void onToggleStatus(AdminUser user);
    }

    private final List<AdminUser> users = new ArrayList<>();
    private final Listener listener;

    public AdminUserAdapter(Listener listener) {
        this.listener = listener;
    }

    public void setUsers(List<AdminUser> newUsers) {
        users.clear();
        if (newUsers != null) users.addAll(newUsers);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_admin_user, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        AdminUser user = users.get(position);
        holder.tvName.setText(user.displayName());
        holder.tvEmail.setText(user.email);
        holder.tvJoinedAt.setText("가입일: " + (user.created_at != null ? user.created_at : "—"));
        holder.tvRole.setText(user.role);

        holder.btnToggleStatus.setText(user.is_active ? "비활성화" : "활성화");
        holder.btnToggleStatus.setBackgroundTintList(ColorStateList.valueOf(
                ContextCompat.getColor(holder.itemView.getContext(), user.is_active ? R.color.dash_danger : R.color.dash_success)));
        holder.btnToggleStatus.setOnClickListener(v -> {
            if (listener != null) listener.onToggleStatus(user);
        });
    }

    @Override
    public int getItemCount() {
        return users.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView tvName;
        final TextView tvEmail;
        final TextView tvJoinedAt;
        final TextView tvRole;
        final Button btnToggleStatus;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            tvName = itemView.findViewById(R.id.tvName);
            tvEmail = itemView.findViewById(R.id.tvEmail);
            tvJoinedAt = itemView.findViewById(R.id.tvJoinedAt);
            tvRole = itemView.findViewById(R.id.tvRole);
            btnToggleStatus = itemView.findViewById(R.id.btnToggleStatus);
        }
    }
}

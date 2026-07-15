package com.ecommerce.eshop.admin;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.ecommerce.eshop.R;

public class AdminFragment extends Fragment {

    private TextView tabAgents;
    private TextView tabProducts;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_admin, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        tabAgents = view.findViewById(R.id.tabAgents);
        tabProducts = view.findViewById(R.id.tabProducts);

        tabAgents.setOnClickListener(v -> selectTab(true));
        tabProducts.setOnClickListener(v -> selectTab(false));

        if (savedInstanceState == null) {
            selectTab(true);
        }
    }

    private void selectTab(boolean agents) {
        tabAgents.setTextColor(ContextCompat.getColor(requireContext(), agents ? R.color.brand_600 : R.color.slate_400));
        tabProducts.setTextColor(ContextCompat.getColor(requireContext(), agents ? R.color.slate_400 : R.color.brand_600));

        Fragment child = agents ? new AdminAgentsFragment() : new AdminProductsFragment();
        getChildFragmentManager()
                .beginTransaction()
                .replace(R.id.adminContainer, child)
                .commit();
    }
}

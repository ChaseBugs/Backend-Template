package com.ecommerce.eshop.profile;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.main.MainActivity;
import com.ecommerce.eshop.model.User;
import com.ecommerce.eshop.session.SessionManager;

public class ProfileFragment extends Fragment {

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_profile, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        SessionManager sessionManager = new SessionManager(requireContext());
        User user = sessionManager.getUser();

        TextView tvName = view.findViewById(R.id.tvName);
        TextView tvEmail = view.findViewById(R.id.tvEmail);
        TextView tvRole = view.findViewById(R.id.tvRole);
        Button btnLogout = view.findViewById(R.id.btnLogout);

        if (user != null) {
            tvName.setText(user.displayName());
            tvEmail.setText(user.email);
            tvRole.setText(user.role);
        }

        btnLogout.setOnClickListener(v -> ((MainActivity) requireActivity()).logout());
    }
}

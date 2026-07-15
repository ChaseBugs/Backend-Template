package com.ecommerce.eshop.auth;

import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.model.LoginResponse;
import com.ecommerce.eshop.model.request.RegisterRequest;
import com.google.android.material.textfield.TextInputEditText;

public class RegisterActivity extends AppCompatActivity {

    private String selectedRole = "user";

    private TextView tabUser;
    private TextView tabAgent;
    private LinearLayout agentFields;
    private TextInputEditText etFirstName;
    private TextInputEditText etLastName;
    private TextInputEditText etEmail;
    private TextInputEditText etPassword;
    private TextInputEditText etPhone;
    private TextInputEditText etBusinessName;
    private TextInputEditText etBusinessNumber;
    private TextView tvError;
    private Button btnRegister;
    private ProgressBar progressBar;

    private ApiService apiService;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_register);
        apiService = ApiClient.getApiService(this);

        tabUser = findViewById(R.id.tabUser);
        tabAgent = findViewById(R.id.tabAgent);
        agentFields = findViewById(R.id.agentFields);
        etFirstName = findViewById(R.id.etFirstName);
        etLastName = findViewById(R.id.etLastName);
        etEmail = findViewById(R.id.etEmail);
        etPassword = findViewById(R.id.etPassword);
        etPhone = findViewById(R.id.etPhone);
        etBusinessName = findViewById(R.id.etBusinessName);
        etBusinessNumber = findViewById(R.id.etBusinessNumber);
        tvError = findViewById(R.id.tvError);
        btnRegister = findViewById(R.id.btnRegister);
        progressBar = findViewById(R.id.progressBar);
        TextView btnGoLogin = findViewById(R.id.btnGoLogin);

        tabUser.setOnClickListener(v -> selectRole("user"));
        tabAgent.setOnClickListener(v -> selectRole("agent"));
        btnRegister.setOnClickListener(v -> attemptRegister());
        btnGoLogin.setOnClickListener(v -> finish());
    }

    private void selectRole(String role) {
        selectedRole = role;
        boolean isAgent = "agent".equals(role);
        agentFields.setVisibility(isAgent ? View.VISIBLE : View.GONE);

        tabUser.setBackgroundColor(ContextCompat.getColor(this, isAgent ? android.R.color.transparent : R.color.brand_600));
        tabUser.setTextColor(ContextCompat.getColor(this, isAgent ? R.color.slate_500 : R.color.white));
        tabAgent.setBackgroundColor(ContextCompat.getColor(this, isAgent ? R.color.brand_600 : android.R.color.transparent));
        tabAgent.setTextColor(ContextCompat.getColor(this, isAgent ? R.color.white : R.color.slate_500));
    }

    private void attemptRegister() {
        String firstName = textOf(etFirstName);
        String lastName = textOf(etLastName);
        String email = textOf(etEmail);
        String password = textOf(etPassword);
        String phone = textOf(etPhone);

        if (TextUtils.isEmpty(firstName) || TextUtils.isEmpty(lastName)
                || TextUtils.isEmpty(email) || TextUtils.isEmpty(password)) {
            showError("필수 항목을 모두 입력해주세요.");
            return;
        }

        RegisterRequest body = new RegisterRequest();
        body.firstName = firstName;
        body.lastName = lastName;
        body.email = email;
        body.password = password;
        body.phone = phone;
        body.role = selectedRole;

        if ("agent".equals(selectedRole)) {
            String businessName = textOf(etBusinessName);
            String businessNumber = textOf(etBusinessNumber);
            if (TextUtils.isEmpty(businessName) || TextUtils.isEmpty(businessNumber)) {
                showError("상호명과 사업자 번호를 입력해주세요.");
                return;
            }
            body.businessName = businessName;
            body.businessNumber = businessNumber;
        }

        setLoading(true);
        apiService.register(body).enqueue(new ApiCallback<LoginResponse>() {
            @Override
            public void onSuccess(LoginResponse data) {
                setLoading(false);
                Toast.makeText(RegisterActivity.this, "가입 완료! 로그인해주세요.", Toast.LENGTH_LONG).show();
                finish();
            }

            @Override
            public void onError(String message) {
                setLoading(false);
                showError(message);
            }
        });
    }

    private String textOf(TextInputEditText field) {
        return field.getText() != null ? field.getText().toString().trim() : "";
    }

    private void setLoading(boolean loading) {
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        btnRegister.setEnabled(!loading);
    }

    private void showError(String message) {
        tvError.setText(message);
        tvError.setVisibility(View.VISIBLE);
    }
}

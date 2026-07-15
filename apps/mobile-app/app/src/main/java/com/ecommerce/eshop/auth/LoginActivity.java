package com.ecommerce.eshop.auth;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.main.MainActivity;
import com.ecommerce.eshop.model.LoginResponse;
import com.ecommerce.eshop.model.request.LoginRequest;
import com.ecommerce.eshop.session.SessionManager;
import com.google.android.material.textfield.TextInputEditText;

public class LoginActivity extends AppCompatActivity {

    private TextInputEditText etEmail;
    private TextInputEditText etPassword;
    private TextView tvError;
    private Button btnLogin;
    private ProgressBar progressBar;

    private SessionManager sessionManager;
    private ApiService apiService;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        sessionManager = new SessionManager(this);
        if (sessionManager.isLoggedIn()) {
            goToMain();
            return;
        }

        setContentView(R.layout.activity_login);
        apiService = ApiClient.getApiService(this);

        etEmail = findViewById(R.id.etEmail);
        etPassword = findViewById(R.id.etPassword);
        tvError = findViewById(R.id.tvError);
        btnLogin = findViewById(R.id.btnLogin);
        progressBar = findViewById(R.id.progressBar);
        TextView btnGoRegister = findViewById(R.id.btnGoRegister);

        btnLogin.setOnClickListener(v -> attemptLogin());
        btnGoRegister.setOnClickListener(v -> startActivity(new Intent(this, RegisterActivity.class)));
    }

    private void attemptLogin() {
        String email = etEmail.getText() != null ? etEmail.getText().toString().trim() : "";
        String password = etPassword.getText() != null ? etPassword.getText().toString() : "";

        if (TextUtils.isEmpty(email) || TextUtils.isEmpty(password)) {
            showError("이메일과 비밀번호를 입력해주세요.");
            return;
        }

        setLoading(true);
        apiService.login(new LoginRequest(email, password)).enqueue(new ApiCallback<LoginResponse>() {
            @Override
            public void onSuccess(LoginResponse data) {
                setLoading(false);
                if (data == null || data.accessToken == null || data.user == null) {
                    showError("로그인에 실패했습니다.");
                    return;
                }
                sessionManager.saveSession(data.accessToken, data.user);
                Toast.makeText(LoginActivity.this, "환영합니다, " + data.user.displayName() + "님!", Toast.LENGTH_SHORT).show();
                goToMain();
            }

            @Override
            public void onError(String message) {
                setLoading(false);
                showError(message);
            }
        });
    }

    private void setLoading(boolean loading) {
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        btnLogin.setEnabled(!loading);
    }

    private void showError(String message) {
        tvError.setText(message);
        tvError.setVisibility(View.VISIBLE);
    }

    private void goToMain() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }
}

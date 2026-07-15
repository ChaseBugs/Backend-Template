package com.ecommerce.eshop.agent;

import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.model.request.CreateProductRequest;

import java.util.Map;
import java.util.regex.Pattern;

public class AddProductActivity extends AppCompatActivity {

    private static final Pattern UUID_PATTERN = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private ApiService apiService;

    private EditText etCategoryId;
    private EditText etName;
    private EditText etDescription;
    private EditText etPrice;
    private EditText etComparePrice;
    private EditText etBrand;
    private EditText etTags;
    private EditText etImageUrl;
    private TextView tvError;
    private Button btnSubmit;
    private ProgressBar progressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_add_product);
        apiService = ApiClient.getApiService(this);

        findViewById(R.id.btnBack).setOnClickListener(v -> finish());

        etCategoryId = findViewById(R.id.etCategoryId);
        etName = findViewById(R.id.etName);
        etDescription = findViewById(R.id.etDescription);
        etPrice = findViewById(R.id.etPrice);
        etComparePrice = findViewById(R.id.etComparePrice);
        etBrand = findViewById(R.id.etBrand);
        etTags = findViewById(R.id.etTags);
        etImageUrl = findViewById(R.id.etImageUrl);
        tvError = findViewById(R.id.tvError);
        btnSubmit = findViewById(R.id.btnSubmit);
        progressBar = findViewById(R.id.progressBar);

        btnSubmit.setOnClickListener(v -> submit());
    }

    private void submit() {
        String categoryId = textOf(etCategoryId);
        String name = textOf(etName);
        String description = textOf(etDescription);
        String priceStr = textOf(etPrice);

        if (TextUtils.isEmpty(categoryId) || TextUtils.isEmpty(name)
                || TextUtils.isEmpty(description) || TextUtils.isEmpty(priceStr)) {
            showError("필수 항목(카테고리, 상품명, 설명, 판매가)을 모두 입력해주세요.");
            return;
        }
        if (!UUID_PATTERN.matcher(categoryId).matches()) {
            showError("카테고리 UUID 형식이 올바르지 않습니다. (예: 8자-4자-4자-4자-12자)");
            return;
        }

        double price;
        try {
            price = Double.parseDouble(priceStr);
        } catch (NumberFormatException e) {
            showError("판매가는 숫자여야 합니다.");
            return;
        }

        CreateProductRequest body = new CreateProductRequest();
        body.categoryId = categoryId;
        body.name = name;
        body.description = description;
        body.price = price;

        String comparePriceStr = textOf(etComparePrice);
        if (!TextUtils.isEmpty(comparePriceStr)) {
            try {
                body.comparePrice = Double.parseDouble(comparePriceStr);
            } catch (NumberFormatException ignored) {
                // leave unset — optional field
            }
        }

        String brand = textOf(etBrand);
        if (!TextUtils.isEmpty(brand)) body.brand = brand;

        String tagsStr = textOf(etTags);
        if (!TextUtils.isEmpty(tagsStr)) {
            for (String tag : tagsStr.split(",")) {
                String trimmed = tag.trim();
                if (!trimmed.isEmpty()) body.tags.add(trimmed);
            }
        }

        String imageUrl = textOf(etImageUrl);
        if (!TextUtils.isEmpty(imageUrl)) body.images.add(imageUrl);

        setLoading(true);
        apiService.createProduct(body).enqueue(new ApiCallback<Map<String, String>>() {
            @Override
            public void onSuccess(Map<String, String> data) {
                setLoading(false);
                Toast.makeText(AddProductActivity.this, "상품이 등록되었습니다! 관리자 승인 대기 중입니다.", Toast.LENGTH_LONG).show();
                finish();
            }

            @Override
            public void onError(String message) {
                setLoading(false);
                showError(message);
            }
        });
    }

    private String textOf(EditText field) {
        return field.getText() != null ? field.getText().toString().trim() : "";
    }

    private void setLoading(boolean loading) {
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        btnSubmit.setEnabled(!loading);
    }

    private void showError(String message) {
        tvError.setText(message);
        tvError.setVisibility(View.VISIBLE);
    }
}

package com.ecommerce.eshop.agent;

import android.app.AlertDialog;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.Product;
import com.ecommerce.eshop.model.request.UpdateProductRequest;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class AgentProductEditActivity extends AppCompatActivity {

    public static final String EXTRA_PRODUCT_ID = "extra_product_id";

    private ApiService apiService;
    private String productId;

    private TextView tvStatusBadge;
    private TextView tvViewCount;
    private TextView tvRating;
    private TextView tvRejectionReason;
    private EditText etName;
    private EditText etDescription;
    private EditText etPrice;
    private EditText etComparePrice;
    private EditText etBrand;
    private EditText etTags;
    private EditText etImageUrl;
    private TextView tvError;
    private ProgressBar progressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_agent_product_edit);
        apiService = ApiClient.getApiService(this);

        productId = getIntent().getStringExtra(EXTRA_PRODUCT_ID);
        if (TextUtils.isEmpty(productId)) {
            finish();
            return;
        }

        findViewById(R.id.btnBack).setOnClickListener(v -> finish());

        tvStatusBadge = findViewById(R.id.tvStatusBadge);
        tvViewCount = findViewById(R.id.tvViewCount);
        tvRating = findViewById(R.id.tvRating);
        tvRejectionReason = findViewById(R.id.tvRejectionReason);
        etName = findViewById(R.id.etName);
        etDescription = findViewById(R.id.etDescription);
        etPrice = findViewById(R.id.etPrice);
        etComparePrice = findViewById(R.id.etComparePrice);
        etBrand = findViewById(R.id.etBrand);
        etTags = findViewById(R.id.etTags);
        etImageUrl = findViewById(R.id.etImageUrl);
        tvError = findViewById(R.id.tvError);
        progressBar = findViewById(R.id.progressBar);

        findViewById(R.id.btnSave).setOnClickListener(v -> save());
        findViewById(R.id.btnDelete).setOnClickListener(v -> confirmDelete());

        load();
    }

    private void load() {
        setLoading(true);
        apiService.getProduct(productId).enqueue(new ApiCallback<Product>() {
            @Override
            public void onSuccess(Product data) {
                setLoading(false);
                if (data == null) return;
                bind(data);
            }

            @Override
            public void onError(String message) {
                setLoading(false);
                showError(message);
            }
        });
    }

    private void bind(Product product) {
        tvStatusBadge.setText(product.status);
        tvViewCount.setText(String.valueOf(product.viewCount));
        if (product.rating != null) {
            tvRating.setText(String.format(Locale.KOREA, "%.1f ★ (%d)", product.rating.average, product.rating.count));
        }
        if ("REJECTED".equals(product.status) && product.rejectionReason != null) {
            tvRejectionReason.setText("거절 사유: " + product.rejectionReason);
            tvRejectionReason.setVisibility(View.VISIBLE);
        }
        etName.setText(product.name);
        etDescription.setText(product.description);
        etPrice.setText(String.valueOf((long) product.price));
        if (product.comparePrice != null) etComparePrice.setText(String.valueOf(product.comparePrice.longValue()));
        etBrand.setText(product.brand);
        if (product.tags != null) etTags.setText(TextUtils.join(", ", product.tags));
        String firstImage = product.firstImage();
        if (firstImage != null) etImageUrl.setText(firstImage);
    }

    private void save() {
        String name = textOf(etName);
        String description = textOf(etDescription);
        String priceStr = textOf(etPrice);

        if (TextUtils.isEmpty(name) || TextUtils.isEmpty(description) || TextUtils.isEmpty(priceStr)) {
            showError("상품명, 설명, 판매가는 비워둘 수 없습니다.");
            return;
        }

        double price;
        try {
            price = Double.parseDouble(priceStr);
        } catch (NumberFormatException e) {
            showError("판매가는 숫자여야 합니다.");
            return;
        }

        UpdateProductRequest body = new UpdateProductRequest();
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
            List<String> tags = new ArrayList<>();
            for (String tag : tagsStr.split(",")) {
                String trimmed = tag.trim();
                if (!trimmed.isEmpty()) tags.add(trimmed);
            }
            body.tags = tags;
        }

        String imageUrl = textOf(etImageUrl);
        if (!TextUtils.isEmpty(imageUrl)) {
            List<String> images = new ArrayList<>();
            images.add(imageUrl);
            body.images = images;
        }

        setLoading(true);
        apiService.updateProduct(productId, body).enqueue(new ApiCallback<MessageResponse>() {
            @Override
            public void onSuccess(MessageResponse data) {
                setLoading(false);
                Toast.makeText(AgentProductEditActivity.this, "수정되었습니다. 관리자 재승인 대기 중입니다.", Toast.LENGTH_LONG).show();
                finish();
            }

            @Override
            public void onError(String message) {
                setLoading(false);
                showError(message);
            }
        });
    }

    private void confirmDelete() {
        new AlertDialog.Builder(this)
                .setMessage("이 상품을 삭제하시겠습니까?")
                .setPositiveButton("삭제", (dialog, which) -> delete())
                .setNegativeButton("취소", null)
                .show();
    }

    private void delete() {
        setLoading(true);
        apiService.deleteProduct(productId).enqueue(new ApiCallback<MessageResponse>() {
            @Override
            public void onSuccess(MessageResponse data) {
                setLoading(false);
                Toast.makeText(AgentProductEditActivity.this, "삭제되었습니다.", Toast.LENGTH_SHORT).show();
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
    }

    private void showError(String message) {
        tvError.setText(message);
        tvError.setVisibility(View.VISIBLE);
    }
}

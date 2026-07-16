package com.ecommerce.eshop.agent;

import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.model.AdCampaign;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.Product;
import com.ecommerce.eshop.model.request.CreateAdCampaignRequest;

import java.util.ArrayList;
import java.util.List;

public class AgentAdCreateActivity extends AppCompatActivity {

    private ApiService apiService;
    private final List<Product> myProducts = new ArrayList<>();

    private Spinner spinnerProduct;
    private EditText etCostPerClick;
    private EditText etDailyBudget;
    private EditText etTotalBudget;
    private TextView tvError;
    private ProgressBar progressBar;
    private Button btnSubmit;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_agent_ad_create);
        apiService = ApiClient.getApiService(this);

        findViewById(R.id.btnBack).setOnClickListener(v -> finish());

        spinnerProduct = findViewById(R.id.spinnerProduct);
        etCostPerClick = findViewById(R.id.etCostPerClick);
        etDailyBudget = findViewById(R.id.etDailyBudget);
        etTotalBudget = findViewById(R.id.etTotalBudget);
        tvError = findViewById(R.id.tvError);
        progressBar = findViewById(R.id.progressBar);
        btnSubmit = findViewById(R.id.btnSubmit);

        btnSubmit.setOnClickListener(v -> submit());

        loadMyProducts();
    }

    private void loadMyProducts() {
        setLoading(true);
        apiService.listMyProducts(1, 100).enqueue(new ApiCallback<PagedList<Product>>() {
            @Override
            public void onSuccess(PagedList<Product> data) {
                setLoading(false);
                myProducts.clear();
                if (data != null && data.data != null) myProducts.addAll(data.data);
                bindProductSpinner();
                if (myProducts.isEmpty()) {
                    showError("광고를 등록하려면 먼저 상품을 등록해야 합니다.");
                    btnSubmit.setEnabled(false);
                }
            }

            @Override
            public void onError(String message) {
                setLoading(false);
                showError(message);
            }
        });
    }

    private void bindProductSpinner() {
        List<String> labels = new ArrayList<>();
        for (Product product : myProducts) labels.add(product.name);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinnerProduct.setAdapter(adapter);
    }

    private void submit() {
        if (myProducts.isEmpty() || spinnerProduct.getSelectedItemPosition() < 0) {
            showError("상품을 선택해주세요.");
            return;
        }
        Product selected = myProducts.get(spinnerProduct.getSelectedItemPosition());

        String cpcStr = textOf(etCostPerClick);
        String dailyStr = textOf(etDailyBudget);
        String totalStr = textOf(etTotalBudget);
        if (TextUtils.isEmpty(cpcStr) || TextUtils.isEmpty(dailyStr) || TextUtils.isEmpty(totalStr)) {
            showError("CPC, 일일 예산, 총 예산을 모두 입력해주세요.");
            return;
        }

        int costPerClick;
        int dailyBudget;
        int totalBudget;
        try {
            costPerClick = Integer.parseInt(cpcStr);
            dailyBudget = Integer.parseInt(dailyStr);
            totalBudget = Integer.parseInt(totalStr);
        } catch (NumberFormatException e) {
            showError("CPC, 예산은 정수로 입력해주세요.");
            return;
        }
        if (costPerClick <= 0 || dailyBudget <= 0 || totalBudget <= 0) {
            showError("모든 금액은 0보다 커야 합니다.");
            return;
        }
        if (totalBudget < dailyBudget) {
            showError("총 예산은 일일 예산 이상이어야 합니다.");
            return;
        }

        CreateAdCampaignRequest body = new CreateAdCampaignRequest();
        body.productId = selected.getProductId();
        body.costPerClick = costPerClick;
        body.dailyBudget = dailyBudget;
        body.totalBudget = totalBudget;

        setLoading(true);
        apiService.createAdCampaign(body).enqueue(new ApiCallback<AdCampaign>() {
            @Override
            public void onSuccess(AdCampaign data) {
                setLoading(false);
                Toast.makeText(AgentAdCreateActivity.this, "캠페인이 등록되었습니다. 관리자 승인 대기 중입니다.", Toast.LENGTH_LONG).show();
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

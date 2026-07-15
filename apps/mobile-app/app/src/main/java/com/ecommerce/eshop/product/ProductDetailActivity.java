package com.ecommerce.eshop.product;

import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.ecommerce.eshop.R;
import com.ecommerce.eshop.api.ApiCallback;
import com.ecommerce.eshop.api.ApiClient;
import com.ecommerce.eshop.api.ApiService;
import com.ecommerce.eshop.home.ProductAdapter;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.Product;
import com.ecommerce.eshop.model.request.AddCartItemRequest;

public class ProductDetailActivity extends AppCompatActivity {

    public static final String EXTRA_PRODUCT_ID = "extra_product_id";

    private ApiService apiService;
    private Product product;
    private int qty = 1;

    private ProgressBar progressBar;
    private LinearLayout contentLayout;
    private TextView tvError;
    private TextView tvEmoji;
    private TextView tvCategory;
    private TextView tvName;
    private TextView tvPrice;
    private TextView tvComparePrice;
    private TextView tvDescription;
    private TextView tvAgent;
    private TextView tvStock;
    private LinearLayout qtyControl;
    private TextView tvQty;
    private Button btnAddToCart;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_product_detail);
        apiService = ApiClient.getApiService(this);

        findViewById(R.id.btnBack).setOnClickListener(v -> finish());

        progressBar = findViewById(R.id.progressBar);
        contentLayout = findViewById(R.id.contentLayout);
        tvError = findViewById(R.id.tvError);
        tvEmoji = findViewById(R.id.tvEmoji);
        tvCategory = findViewById(R.id.tvCategory);
        tvName = findViewById(R.id.tvName);
        tvPrice = findViewById(R.id.tvPrice);
        tvComparePrice = findViewById(R.id.tvComparePrice);
        tvDescription = findViewById(R.id.tvDescription);
        tvAgent = findViewById(R.id.tvAgent);
        tvStock = findViewById(R.id.tvStock);
        qtyControl = findViewById(R.id.qtyControl);
        tvQty = findViewById(R.id.tvQty);
        btnAddToCart = findViewById(R.id.btnAddToCart);

        findViewById(R.id.btnQtyMinus).setOnClickListener(v -> changeQty(-1));
        findViewById(R.id.btnQtyPlus).setOnClickListener(v -> changeQty(1));
        btnAddToCart.setOnClickListener(v -> addToCart());

        String productId = getIntent().getStringExtra(EXTRA_PRODUCT_ID);
        if (productId == null) {
            finish();
            return;
        }
        loadProduct(productId);
    }

    private void loadProduct(String productId) {
        apiService.getProduct(productId).enqueue(new ApiCallback<Product>() {
            @Override
            public void onSuccess(Product data) {
                product = data;
                bindProduct(data);
            }

            @Override
            public void onError(String message) {
                progressBar.setVisibility(View.GONE);
                tvError.setText(message);
                tvError.setVisibility(View.VISIBLE);
            }
        });
    }

    private void bindProduct(Product p) {
        progressBar.setVisibility(View.GONE);
        contentLayout.setVisibility(View.VISIBLE);

        tvEmoji.setText(ProductAdapter.emojiFor(p.categoryName));
        tvCategory.setText(p.categoryName != null ? p.categoryName : "");
        tvName.setText(p.name);
        tvPrice.setText(ProductAdapter.formatWon(p.price));

        if (p.comparePrice != null) {
            tvComparePrice.setText(ProductAdapter.formatWon(p.comparePrice));
            tvComparePrice.setPaintFlags(tvComparePrice.getPaintFlags() | android.graphics.Paint.STRIKE_THRU_TEXT_FLAG);
            tvComparePrice.setVisibility(View.VISIBLE);
        }

        tvDescription.setText(p.description != null ? p.description : "");
        tvAgent.setText("판매자: " + (p.agentName != null ? p.agentName : "—"));

        boolean inStock = p.inStock();
        tvStock.setText(p.stock != null ? ("재고: " + p.stock + "개") : "재고 정보 없음");

        if (inStock) {
            qtyControl.setVisibility(View.VISIBLE);
            btnAddToCart.setEnabled(true);
            btnAddToCart.setText("장바구니 담기");
        } else {
            qtyControl.setVisibility(View.GONE);
            btnAddToCart.setEnabled(false);
            btnAddToCart.setText("품절");
        }
    }

    private void changeQty(int delta) {
        if (product == null) return;
        int max = product.stock != null ? product.stock : Integer.MAX_VALUE;
        qty = Math.max(1, Math.min(max, qty + delta));
        tvQty.setText(String.valueOf(qty));
    }

    private void addToCart() {
        if (product == null) return;
        btnAddToCart.setEnabled(false);
        AddCartItemRequest body = new AddCartItemRequest(
                product.getProductId(), qty, product.price, product.name, product.agentId);
        apiService.addCartItem(body).enqueue(new ApiCallback<MessageResponse>() {
            @Override
            public void onSuccess(MessageResponse data) {
                btnAddToCart.setEnabled(true);
                Toast.makeText(ProductDetailActivity.this,
                        product.name + " (" + qty + "개) 장바구니에 추가되었습니다! 🎉", Toast.LENGTH_SHORT).show();
            }

            @Override
            public void onError(String message) {
                btnAddToCart.setEnabled(true);
                Toast.makeText(ProductDetailActivity.this, "오류: " + message, Toast.LENGTH_SHORT).show();
            }
        });
    }
}

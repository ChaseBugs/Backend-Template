package com.ecommerce.eshop.checkout;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
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
import com.ecommerce.eshop.main.MainActivity;
import com.ecommerce.eshop.model.Cart;
import com.ecommerce.eshop.model.CartItem;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.Order;
import com.ecommerce.eshop.model.ProductInfo;
import com.ecommerce.eshop.model.ShippingAddress;
import com.ecommerce.eshop.model.User;
import com.ecommerce.eshop.model.request.CreateOrderRequest;
import com.ecommerce.eshop.model.request.OrderItemRequest;
import com.ecommerce.eshop.session.SessionManager;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class CheckoutActivity extends AppCompatActivity {

    private ApiService apiService;
    private SessionManager sessionManager;
    private List<CartItem> cartItems = new ArrayList<>();

    private EditText etRecipientName;
    private EditText etPhone;
    private EditText etAddressLine1;
    private EditText etAddressLine2;
    private EditText etCity;
    private EditText etPostalCode;
    private LinearLayout orderSummary;
    private TextView tvTotal;
    private TextView tvError;
    private Button btnSubmitOrder;
    private ProgressBar progressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_checkout);
        apiService = ApiClient.getApiService(this);
        sessionManager = new SessionManager(this);

        etRecipientName = findViewById(R.id.etRecipientName);
        etPhone = findViewById(R.id.etPhone);
        etAddressLine1 = findViewById(R.id.etAddressLine1);
        etAddressLine2 = findViewById(R.id.etAddressLine2);
        etCity = findViewById(R.id.etCity);
        etPostalCode = findViewById(R.id.etPostalCode);
        orderSummary = findViewById(R.id.orderSummary);
        tvTotal = findViewById(R.id.tvTotal);
        tvError = findViewById(R.id.tvError);
        btnSubmitOrder = findViewById(R.id.btnSubmitOrder);
        progressBar = findViewById(R.id.progressBar);

        User user = sessionManager.getUser();
        if (user != null) {
            etRecipientName.setText(user.displayName());
        }

        btnSubmitOrder.setOnClickListener(v -> submitOrder());

        loadCart();
    }

    private void loadCart() {
        apiService.getCart().enqueue(new ApiCallback<Cart>() {
            @Override
            public void onSuccess(Cart data) {
                if (data == null || data.items == null || data.items.isEmpty()) {
                    Toast.makeText(CheckoutActivity.this, "장바구니가 비어있습니다.", Toast.LENGTH_SHORT).show();
                    finish();
                    return;
                }
                cartItems = data.items;
                renderSummary(data);
            }

            @Override
            public void onError(String message) {
                Toast.makeText(CheckoutActivity.this, "오류: " + message, Toast.LENGTH_SHORT).show();
                finish();
            }
        });
    }

    private void renderSummary(Cart cart) {
        orderSummary.removeAllViews();
        for (CartItem item : cart.items) {
            TextView row = new TextView(this);
            String label = item.productName.length() > 18 ? item.productName.substring(0, 18) + "..." : item.productName;
            row.setText(label + " × " + item.quantity + "  —  " + ProductAdapter.formatWon(item.subtotal()));
            row.setTextColor(getResources().getColor(R.color.slate_500));
            row.setPadding(0, 4, 0, 4);
            orderSummary.addView(row);
        }
        tvTotal.setText(ProductAdapter.formatWon(cart.total));
    }

    private void submitOrder() {
        String recipientName = textOf(etRecipientName);
        String phone = textOf(etPhone);
        String addressLine1 = textOf(etAddressLine1);
        String addressLine2 = textOf(etAddressLine2);
        String city = textOf(etCity);
        String postalCode = textOf(etPostalCode);

        if (TextUtils.isEmpty(recipientName) || TextUtils.isEmpty(phone)
                || TextUtils.isEmpty(addressLine1) || TextUtils.isEmpty(city) || TextUtils.isEmpty(postalCode)) {
            showError("배송 정보를 모두 입력해주세요.");
            return;
        }

        List<OrderItemRequest> items = new ArrayList<>();
        Map<String, ProductInfo> productInfoMap = new HashMap<>();
        for (CartItem item : cartItems) {
            items.add(new OrderItemRequest(item.productId, item.quantity));
            String image = (item.images != null && !item.images.isEmpty()) ? item.images.get(0) : null;
            productInfoMap.put(item.productId,
                    new ProductInfo(item.productId, item.agentId, item.productName, image, item.unitPrice));
        }

        ShippingAddress shippingAddress = new ShippingAddress(
                recipientName, phone, addressLine1,
                TextUtils.isEmpty(addressLine2) ? null : addressLine2,
                city, postalCode);

        setLoading(true);
        apiService.createOrder(new CreateOrderRequest(items, shippingAddress, productInfoMap))
                .enqueue(new ApiCallback<Order>() {
                    @Override
                    public void onSuccess(Order data) {
                        clearCartThenNavigate();
                    }

                    @Override
                    public void onError(String message) {
                        setLoading(false);
                        showError(message);
                    }
                });
    }

    private void clearCartThenNavigate() {
        apiService.clearCart().enqueue(new ApiCallback<MessageResponse>() {
            @Override
            public void onSuccess(MessageResponse data) {
                goToOrders();
            }

            @Override
            public void onError(String message) {
                // Order already succeeded — a stale cart is a lesser problem than blocking the user here.
                goToOrders();
            }
        });
    }

    private void goToOrders() {
        setLoading(false);
        Toast.makeText(this, "주문이 완료되었습니다! 🎉", Toast.LENGTH_SHORT).show();
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra(MainActivity.EXTRA_TAB, "orders");
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }

    private String textOf(EditText field) {
        return field.getText() != null ? field.getText().toString().trim() : "";
    }

    private void setLoading(boolean loading) {
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        btnSubmitOrder.setEnabled(!loading);
    }

    private void showError(String message) {
        tvError.setText(message);
        tvError.setVisibility(View.VISIBLE);
    }
}

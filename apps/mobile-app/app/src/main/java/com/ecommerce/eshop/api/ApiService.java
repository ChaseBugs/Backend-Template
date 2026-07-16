package com.ecommerce.eshop.api;

import com.ecommerce.eshop.model.AdCampaign;
import com.ecommerce.eshop.model.AdminProductList;
import com.ecommerce.eshop.model.AdminUser;
import com.ecommerce.eshop.model.AgentFulfillmentSummary;
import com.ecommerce.eshop.model.AgentInventorySummary;
import com.ecommerce.eshop.model.AgentProfile;
import com.ecommerce.eshop.model.AgentSalesSummary;
import com.ecommerce.eshop.model.AgentSettlementSummary;
import com.ecommerce.eshop.model.ApiEnvelope;
import com.ecommerce.eshop.model.BuyBoxView;
import com.ecommerce.eshop.model.Cart;
import com.ecommerce.eshop.model.DashboardSummary;
import com.ecommerce.eshop.model.LoginResponse;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.Order;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.Product;
import com.ecommerce.eshop.model.SearchResult;
import com.ecommerce.eshop.model.request.AddCartItemRequest;
import com.ecommerce.eshop.model.request.ApproveAgentRequest;
import com.ecommerce.eshop.model.request.CreateAdCampaignRequest;
import com.ecommerce.eshop.model.request.CreateOrderRequest;
import com.ecommerce.eshop.model.request.CreateProductRequest;
import com.ecommerce.eshop.model.request.LoginRequest;
import com.ecommerce.eshop.model.request.ReasonRequest;
import com.ecommerce.eshop.model.request.RegisterRequest;
import com.ecommerce.eshop.model.request.UpdateProductRequest;
import com.ecommerce.eshop.model.request.UpdateQuantityRequest;
import com.ecommerce.eshop.model.request.UpdateUserStatusRequest;

import java.util.Map;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.DELETE;
import retrofit2.http.GET;
import retrofit2.http.PATCH;
import retrofit2.http.POST;
import retrofit2.http.Path;
import retrofit2.http.Query;

/** Every path here is relative to {gateway}/api/v1/ — verified directly against each service's route file, not assumed. */
public interface ApiService {

    @POST("auth/login")
    Call<ApiEnvelope<LoginResponse>> login(@Body LoginRequest body);

    @POST("auth/register")
    Call<ApiEnvelope<LoginResponse>> register(@Body RegisterRequest body);

    @GET("products")
    Call<ApiEnvelope<PagedList<Product>>> listProducts(
            @Query("page") int page, @Query("limit") int limit,
            @Query("sortBy") String sortBy, @Query("sortOrder") String sortOrder);

    @GET("products/{id}")
    Call<ApiEnvelope<Product>> getProduct(@Path("id") String id);

    @GET("products/my")
    Call<ApiEnvelope<PagedList<Product>>> listMyProducts(@Query("page") int page, @Query("limit") int limit);

    @POST("products")
    Call<ApiEnvelope<Map<String, String>>> createProduct(@Body CreateProductRequest body);

    @PATCH("products/{id}")
    Call<ApiEnvelope<MessageResponse>> updateProduct(@Path("id") String id, @Body UpdateProductRequest body);

    @DELETE("products/{id}")
    Call<ApiEnvelope<MessageResponse>> deleteProduct(@Path("id") String id);

    @GET("products/pending")
    Call<ApiEnvelope<PagedList<Product>>> listPendingProducts(@Query("page") int page, @Query("limit") int limit);

    @PATCH("products/{id}/approve")
    Call<ApiEnvelope<MessageResponse>> approveProduct(@Path("id") String id, @Body Map<String, String> emptyBody);

    @PATCH("products/{id}/reject")
    Call<ApiEnvelope<MessageResponse>> rejectProduct(@Path("id") String id, @Body ReasonRequest body);

    @GET("search")
    Call<ApiEnvelope<SearchResult>> search(@Query("q") String query, @Query("limit") int limit);

    @GET("cart")
    Call<ApiEnvelope<Cart>> getCart();

    @POST("cart/items")
    Call<ApiEnvelope<MessageResponse>> addCartItem(@Body AddCartItemRequest body);

    @PATCH("cart/items/{productId}")
    Call<ApiEnvelope<MessageResponse>> updateCartItem(@Path("productId") String productId, @Body UpdateQuantityRequest body);

    @DELETE("cart/items/{productId}")
    Call<ApiEnvelope<MessageResponse>> removeCartItem(@Path("productId") String productId);

    @DELETE("cart")
    Call<ApiEnvelope<MessageResponse>> clearCart();

    @POST("orders")
    Call<ApiEnvelope<Order>> createOrder(@Body CreateOrderRequest body);

    @GET("orders")
    Call<ApiEnvelope<PagedList<Order>>> listOrders(@Query("page") int page, @Query("limit") int limit);

    @PATCH("orders/{id}/cancel")
    Call<ApiEnvelope<MessageResponse>> cancelOrder(@Path("id") String id, @Body ReasonRequest body);

    @GET("agents/pending")
    Call<ApiEnvelope<PagedList<AgentProfile>>> listPendingAgents(@Query("page") int page, @Query("limit") int limit);

    @PATCH("agents/{id}/approve")
    Call<ApiEnvelope<MessageResponse>> approveAgent(@Path("id") String id, @Body ApproveAgentRequest body);

    @PATCH("agents/{id}/reject")
    Call<ApiEnvelope<MessageResponse>> rejectAgent(@Path("id") String id, @Body ReasonRequest body);

    @GET("admin/dashboard")
    Call<ApiEnvelope<DashboardSummary>> getAdminDashboard();

    @GET("admin/users")
    Call<ApiEnvelope<PagedList<AdminUser>>> listAdminUsers(@Query("page") int page, @Query("limit") int limit);

    @PATCH("admin/users/{userId}/status")
    Call<ApiEnvelope<MessageResponse>> updateUserStatus(@Path("userId") String userId, @Body UpdateUserStatusRequest body);

    @GET("admin/products")
    Call<ApiEnvelope<AdminProductList>> listAdminProducts(
            @Query("page") int page, @Query("limit") int limit,
            @Query("status") String status, @Query("search") String search);

    @GET("orders/agent/summary")
    Call<ApiEnvelope<AgentSalesSummary>> getAgentSalesSummary(@Query("from") String from, @Query("to") String to);

    @GET("payments/settlements/summary")
    Call<ApiEnvelope<AgentSettlementSummary>> getAgentSettlementSummary();

    @GET("inventory/agent/summary")
    Call<ApiEnvelope<AgentInventorySummary>> getAgentInventorySummary();

    @GET("deliveries/my/summary")
    Call<ApiEnvelope<AgentFulfillmentSummary>> getAgentFulfillmentSummary();

    @GET("products/catalog/variants/{variantId}/buybox")
    Call<ApiEnvelope<BuyBoxView>> getBuyBox(@Path("variantId") String variantId);

    @POST("ads/campaigns")
    Call<ApiEnvelope<AdCampaign>> createAdCampaign(@Body CreateAdCampaignRequest body);

    @GET("ads/campaigns/my")
    Call<ApiEnvelope<PagedList<AdCampaign>>> listMyAdCampaigns(
            @Query("page") int page, @Query("limit") int limit, @Query("status") String status);

    @PATCH("ads/campaigns/{id}/pause")
    Call<ApiEnvelope<AdCampaign>> pauseAdCampaign(@Path("id") String id, @Body Map<String, String> emptyBody);

    @PATCH("ads/campaigns/{id}/resume")
    Call<ApiEnvelope<AdCampaign>> resumeAdCampaign(@Path("id") String id, @Body Map<String, String> emptyBody);
}

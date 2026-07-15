package com.ecommerce.eshop.api;

import com.ecommerce.eshop.model.AgentProfile;
import com.ecommerce.eshop.model.ApiEnvelope;
import com.ecommerce.eshop.model.Cart;
import com.ecommerce.eshop.model.LoginResponse;
import com.ecommerce.eshop.model.MessageResponse;
import com.ecommerce.eshop.model.Order;
import com.ecommerce.eshop.model.PagedList;
import com.ecommerce.eshop.model.Product;
import com.ecommerce.eshop.model.SearchResult;
import com.ecommerce.eshop.model.request.AddCartItemRequest;
import com.ecommerce.eshop.model.request.ApproveAgentRequest;
import com.ecommerce.eshop.model.request.CreateOrderRequest;
import com.ecommerce.eshop.model.request.CreateProductRequest;
import com.ecommerce.eshop.model.request.LoginRequest;
import com.ecommerce.eshop.model.request.ReasonRequest;
import com.ecommerce.eshop.model.request.RegisterRequest;
import com.ecommerce.eshop.model.request.UpdateQuantityRequest;

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
}

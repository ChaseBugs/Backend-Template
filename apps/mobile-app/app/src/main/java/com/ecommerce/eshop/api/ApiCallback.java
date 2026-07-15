package com.ecommerce.eshop.api;

import androidx.annotation.NonNull;

import com.ecommerce.eshop.model.ApiEnvelope;
import com.google.gson.Gson;

import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Collapses Retrofit's Call/Response/Throwable split into two methods so every
 * screen doesn't re-implement the same success/error/envelope-unwrapping boilerplate.
 *
 * Retrofit only populates response.body() for 2xx responses — for 4xx/5xx it is always
 * null and the JSON error envelope (success:false, error:{code,message}) is instead in
 * response.errorBody(), which must be parsed separately.
 */
public abstract class ApiCallback<T> implements Callback<ApiEnvelope<T>> {

    private static final Gson GSON = new Gson();

    public abstract void onSuccess(T data);

    public abstract void onError(String message);

    @Override
    public final void onResponse(@NonNull Call<ApiEnvelope<T>> call, @NonNull Response<ApiEnvelope<T>> response) {
        if (response.isSuccessful()) {
            ApiEnvelope<T> body = response.body();
            if (body != null && body.success) {
                onSuccess(body.data);
                return;
            }
            onError("서버 응답을 처리할 수 없습니다.");
            return;
        }
        onError(parseErrorMessage(response));
    }

    private String parseErrorMessage(Response<ApiEnvelope<T>> response) {
        ResponseBody errorBody = response.errorBody();
        if (errorBody != null) {
            try {
                ApiEnvelope<?> parsed = GSON.fromJson(errorBody.string(), ApiEnvelope.class);
                if (parsed != null && parsed.error != null && parsed.error.message != null) {
                    return parsed.error.message;
                }
            } catch (Exception ignored) {
                // fall through to the generic message below
            }
        }
        return "요청에 실패했습니다 (HTTP " + response.code() + ")";
    }

    @Override
    public final void onFailure(@NonNull Call<ApiEnvelope<T>> call, @NonNull Throwable t) {
        onError(t.getMessage() != null ? t.getMessage() : "네트워크 오류가 발생했습니다.");
    }
}

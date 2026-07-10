export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export function successResponse<T>(data: T, meta?: Record<string, unknown>): ApiSuccessResponse<T> {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

export function errorResponse(code: string, message: string, details?: unknown, requestId?: string): ApiErrorResponse {
  return {
    success: false,
    error: { code, message, details },
    ...(requestId ? { requestId } : {}),
  };
}

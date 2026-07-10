export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'INTERNAL_SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'UNPROCESSABLE_ENTITY'
  | 'TOO_MANY_REQUESTS';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} not found: ${id}` : `${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'UNPROCESSABLE_ENTITY', details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string) {
    super(`Service unavailable: ${service}`, 503, 'SERVICE_UNAVAILABLE', undefined, false);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'TOO_MANY_REQUESTS');
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toHttpError(err: unknown): { statusCode: number; code: string; message: string; details?: unknown } {
  if (isAppError(err)) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }
  return {
    statusCode: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
  };
}

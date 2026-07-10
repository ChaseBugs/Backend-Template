import { Request, Response, NextFunction } from 'express';
import { isAppError, toHttpError } from '@ecommerce/errors';
import { errorResponse } from '@ecommerce/shared';
import { Logger } from '@ecommerce/logger';

export function createErrorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (isAppError(err) && err.isOperational) {
      logger.warn({ err, url: req.url, method: req.method }, 'Operational error');
    } else {
      logger.error({ err, url: req.url, method: req.method }, 'Unexpected error');
    }

    const { statusCode, code, message, details } = toHttpError(err);
    res.status(statusCode).json(errorResponse(code, message, details));
  };
}

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '@ecommerce/errors';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issues = (result.error as ZodError).errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      return next(new ValidationError('Validation failed', issues));
    }
    req[source] = result.data;
    next();
  };
}

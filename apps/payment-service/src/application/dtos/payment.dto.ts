import { z } from 'zod';

export const CreatePaymentSchema = z.object({
  orderId: z.string().uuid(),
  method: z.enum(['CARD', 'BANK_TRANSFER', 'VIRTUAL_ACCOUNT']),
  idempotencyKey: z.string().min(1).max(255),
});

export const CreateRefundSchema = z.object({
  refundAmount: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().min(1).max(200),
});

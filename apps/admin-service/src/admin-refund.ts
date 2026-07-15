import { BadRequestError } from '@ecommerce/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdminRefundInput {
  refundAmount: number;
  reason: string;
  idempotencyKey: string;
}

export function parseAdminRefundInput(paymentId: string, body: unknown): AdminRefundInput {
  if (!UUID.test(paymentId)) throw new BadRequestError('paymentId must be a UUID');
  if (!body || typeof body !== 'object') throw new BadRequestError('Refund request body is required');

  const value = body as Record<string, unknown>;
  const refundAmount = Number(value.refundAmount);
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const idempotencyKey = typeof value.idempotencyKey === 'string' ? value.idempotencyKey.trim() : '';

  if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0) {
    throw new BadRequestError('refundAmount must be a positive integer');
  }
  if (!reason || reason.length > 500) throw new BadRequestError('reason must be between 1 and 500 characters');
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new BadRequestError('idempotencyKey must be between 1 and 200 characters');
  }

  return { refundAmount, reason, idempotencyKey };
}

import { z } from 'zod';

const ShippingAddressSchema = z.object({
  recipientName: z.string().min(1).max(100),
  phone: z.string().min(1).max(20),
  addressLine1: z.string().min(1).max(255),
  addressLine2: z.string().max(255).optional(),
  city: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
});

const OrderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export const CreateOrderSchema = z.object({
  items: z.array(OrderItemSchema).min(1).max(50),
  shippingAddress: ShippingAddressSchema,
  couponCode: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()).optional(),
  idempotencyKey: z.string().min(1).max(200),
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.items.forEach((item, index) => {
    if (ids.has(item.productId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', index, 'productId'], message: 'Duplicate products are not allowed' });
    }
    ids.add(item.productId);
  });
});

export const CancelOrderSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type CreateOrderDto = z.infer<typeof CreateOrderSchema>;
export type CancelOrderDto = z.infer<typeof CancelOrderSchema>;

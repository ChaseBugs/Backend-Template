import { z } from 'zod';

export const CreateProductSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(500),
  description: z.string().min(1).max(10000),
  price: z.number().positive(),
  comparePrice: z.number().positive().optional(),
  brand: z.string().max(255).optional(),
  tags: z.array(z.string().max(100)).max(20).default([]),
  images: z.array(z.string().url()).max(10).default([]),
});

export const UpdateProductSchema = CreateProductSchema.partial();

export const RejectProductSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const ProductListQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  brand: z.string().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  inStock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['price', 'createdAt', 'viewCount', 'rating.average']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateProductDto = z.infer<typeof CreateProductSchema>;
export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;
export type RejectProductDto = z.infer<typeof RejectProductSchema>;
export type ProductListQueryDto = z.infer<typeof ProductListQuerySchema>;

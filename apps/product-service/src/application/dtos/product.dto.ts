import { z } from 'zod';

const ProductFieldsSchema = z.object({
  catalogVariantId: z.string().uuid().optional(),
  catalog: z.object({
    gtin: z.string().regex(/^[0-9]{8,14}$/).optional(),
    manufacturer: z.string().min(1).max(150).optional(),
    modelNumber: z.string().min(1).max(100).optional(),
    variantName: z.string().min(1).max(255).optional(),
    variantGtin: z.string().regex(/^[0-9]{8,14}$/).optional(),
    variantAttributes: z.record(z.string().max(100)).default({}),
  }).optional(),
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(500),
  description: z.string().min(1).max(10000),
  price: z.number().positive(),
  comparePrice: z.number().positive().optional(),
  brand: z.string().max(255).optional(),
  tags: z.array(z.string().max(100)).max(20).default([]),
  images: z.array(z.string().url()).max(10).default([]),
  sku: z.string().trim().min(1).max(100),
  condition: z.enum(['NEW','OPEN_BOX','REFURBISHED','USED_LIKE_NEW','USED_GOOD','USED_ACCEPTABLE']).default('NEW'),
});

export const CreateProductSchema = ProductFieldsSchema.refine((value) => !(value.catalogVariantId && value.catalog), {
  message: 'Provide catalogVariantId or catalog metadata, not both',
});

export const UpdateProductSchema = ProductFieldsSchema.omit({
  catalogVariantId: true, catalog: true, sku: true, condition: true,
}).partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one product field is required' },
);

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

export const CatalogSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  gtin: z.string().regex(/^[0-9]{8,14}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).refine((value) => value.q || value.gtin, { message: 'q or gtin is required' });

export type CreateProductDto = z.infer<typeof CreateProductSchema>;
export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;
export type RejectProductDto = z.infer<typeof RejectProductSchema>;
export type ProductListQueryDto = z.infer<typeof ProductListQuerySchema>;
export type CatalogSearchQueryDto = z.infer<typeof CatalogSearchQuerySchema>;

import { Filter } from 'mongodb';
import { getProductCollection } from '../../infrastructure/db/mongo-client';
import { ProductReadModel, ProductStatus } from '../entities/product.entity';
import { RedisClient } from '@ecommerce/redis-client';
import { config } from '../../config';

export interface ProductListQuery {
  categoryId?: string;
  agentId?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  status?: ProductStatus;
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export class ProductReadRepository {
  constructor(private readonly redis: RedisClient) {}

  async findById(id: string): Promise<ProductReadModel | null> {
    const cacheKey = `product:${id}`;
    const cached = await (this.redis as any).get(cacheKey);
    if (cached) return JSON.parse(cached);

    const product = await getProductCollection().findOne({ _id: id } as Filter<ProductReadModel>);
    if (product) {
      await (this.redis as any).setex(cacheKey, config.cache.productTtl, JSON.stringify(product));
    }
    return product;
  }

  async findMany(query: ProductListQuery): Promise<{ products: ProductReadModel[]; total: number }> {
    const filter: Filter<ProductReadModel> = {};

    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.agentId) filter.agentId = query.agentId;
    if (query.brand) filter.brand = query.brand;
    if (query.status) filter.status = query.status;
    else filter.status = ProductStatus.ACTIVE;

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {};
      if (query.minPrice !== undefined) (filter.price as any).$gte = query.minPrice;
      if (query.maxPrice !== undefined) (filter.price as any).$lte = query.maxPrice;
    }

    if (query.inStock !== undefined) {
      filter.stock = query.inStock ? ({ $gt: 0 } as any) : ({ $lte: 0 } as any);
    }

    const sortField = query.sortBy ?? 'createdAt';
    const sortDir = query.sortOrder === 'asc' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;

    const collection = getProductCollection();
    const [products, total] = await Promise.all([
      collection.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(query.limit).toArray(),
      collection.countDocuments(filter),
    ]);

    return { products, total };
  }

  async invalidateCache(productId: string): Promise<void> {
    await (this.redis as any).del(`product:${productId}`);
  }
}

import { v4 as uuidv4 } from 'uuid';
import { ProductWriteRepository } from '../../domain/repositories/product-write.repository';
import { ProductReadRepository } from '../../domain/repositories/product-read.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { KafkaTopic } from '@ecommerce/shared';
import { NotFoundError, ForbiddenError } from '@ecommerce/errors';
import { CreateProductDto, UpdateProductDto, RejectProductDto, ProductListQueryDto } from '../dtos/product.dto';
import { ProductReadModel } from '../../domain/entities/product.entity';

export class ProductUseCases {
  constructor(
    private readonly writeRepo: ProductWriteRepository,
    private readonly readRepo: ProductReadRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async create(dto: CreateProductDto, agentId: string): Promise<{ id: string }> {
    const id = uuidv4();
    const product = await this.writeRepo.create({ id, agentId, ...dto });

    await this.kafkaProducer.send(
      KafkaTopic.PRODUCT_CREATED,
      {
        topic: KafkaTopic.PRODUCT_CREATED,
        payload: {
          productId: product.id,
          agentId,
          name: product.name,
          price: product.price,
          categoryId: product.categoryId,
          brand: product.brand,
          tags: product.tags,
          initialStock: 0,
        },
      },
      product.id,
    );

    return { id: product.id };
  }

  async getById(id: string): Promise<ProductReadModel> {
    const product = await this.readRepo.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    return product;
  }

  async list(query: ProductListQueryDto): Promise<{ products: ProductReadModel[]; total: number }> {
    return this.readRepo.findMany(query);
  }

  async update(id: string, dto: UpdateProductDto, agentId: string): Promise<void> {
    const product = await this.writeRepo.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    if (product.agentId !== agentId) throw new ForbiddenError('You do not own this product');

    await this.writeRepo.update(id, agentId, dto);
    await this.readRepo.invalidateCache(id);

    await this.kafkaProducer.send(
      KafkaTopic.PRODUCT_UPDATED,
      {
        topic: KafkaTopic.PRODUCT_UPDATED,
        payload: { productId: id, agentId, changes: dto as Record<string, unknown> },
      },
      id,
    );
  }

  async approve(id: string, approvedBy: string): Promise<void> {
    const product = await this.writeRepo.approve(id, approvedBy);
    if (!product) throw new NotFoundError('Product', id);
    await this.readRepo.invalidateCache(id);

    await this.kafkaProducer.send(
      KafkaTopic.PRODUCT_APPROVED,
      { topic: KafkaTopic.PRODUCT_APPROVED, payload: { productId: id, approvedBy } },
      id,
    );
  }

  async reject(id: string, approvedBy: string, dto: RejectProductDto): Promise<void> {
    const product = await this.writeRepo.reject(id, approvedBy, dto.reason);
    if (!product) throw new NotFoundError('Product', id);
    await this.readRepo.invalidateCache(id);

    await this.kafkaProducer.send(
      KafkaTopic.PRODUCT_REJECTED,
      { topic: KafkaTopic.PRODUCT_REJECTED, payload: { productId: id, approvedBy, reason: dto.reason } },
      id,
    );
  }

  async delete(id: string, agentId: string): Promise<void> {
    const deleted = await this.writeRepo.softDelete(id, agentId);
    if (!deleted) throw new NotFoundError('Product', id);
    await this.readRepo.invalidateCache(id);

    await this.kafkaProducer.send(
      KafkaTopic.PRODUCT_DELETED,
      { topic: KafkaTopic.PRODUCT_DELETED, payload: { productId: id, agentId } },
      id,
    );
  }

  async listByAgent(agentId: string, page: number, limit: number) {
    const offset = (page - 1) * limit;
    return this.writeRepo.findByAgent(agentId, limit, offset);
  }

  async listPendingApproval(page: number, limit: number) {
    const offset = (page - 1) * limit;
    return this.writeRepo.findPendingApproval(limit, offset);
  }
}

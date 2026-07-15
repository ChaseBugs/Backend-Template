import { v4 as uuidv4 } from 'uuid';
import { ProductWriteRepository } from '../../domain/repositories/product-write.repository';
import { ProductReadRepository } from '../../domain/repositories/product-read.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { KafkaTopic } from '@ecommerce/shared';
import { ConflictError, NotFoundError, ForbiddenError } from '@ecommerce/errors';
import { CatalogSearchQueryDto, CreateProductDto, UpdateProductDto, RejectProductDto, ProductListQueryDto } from '../dtos/product.dto';
import { ProductReadModel, ProductStatus } from '../../domain/entities/product.entity';

export class ProductUseCases {
  constructor(
    private readonly writeRepo: ProductWriteRepository,
    private readonly readRepo: ProductReadRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async searchCatalog(query: CatalogSearchQueryDto) {
    return this.writeRepo.searchCatalog(query);
  }

  async listCatalogOffers(catalogVariantId: string) {
    return this.writeRepo.listActiveOffers(catalogVariantId);
  }

  async create(dto: CreateProductDto, agentId: string, idempotencyKey: string): Promise<{ id: string }> {
    const existing = await this.writeRepo.findByIdempotencyKey(agentId, idempotencyKey);
    if (existing) {
      return this.replayCreate(existing, dto);
    }
    const id = uuidv4();
    let product;
    try {
      product = await this.writeRepo.create({ id, agentId, idempotencyKey, ...dto });
    } catch (error) {
      // A concurrent request may win the unique-key race after the initial lookup.
      if (!this.isUniqueViolation(error)) throw error;
      const concurrent = await this.writeRepo.findByIdempotencyKey(agentId, idempotencyKey);
      if (!concurrent) throw error;
      return this.replayCreate(concurrent, dto);
    }

    await this.publishCreated(product);
    return { id: product.id };
  }

  private async replayCreate(product: Awaited<ReturnType<ProductWriteRepository['create']>>, dto: CreateProductDto): Promise<{ id: string }> {
    const matches = product.categoryId === dto.categoryId && product.name === dto.name
      && product.description === dto.description && product.price === dto.price
      && product.comparePrice === dto.comparePrice && product.brand === dto.brand
      && product.sku === dto.sku && product.condition === dto.condition
      && (!dto.catalogVariantId || product.catalogVariantId === dto.catalogVariantId)
      && JSON.stringify(product.tags) === JSON.stringify(dto.tags)
      && JSON.stringify(product.images) === JSON.stringify(dto.images);
    if (!matches) throw new ConflictError('Idempotency key is already used for another product');
    await this.publishCreated(product);
    return { id: product.id };
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: string }).code === '23505';
  }

  private async publishCreated(product: Awaited<ReturnType<ProductWriteRepository['create']>>): Promise<void> {
    await this.kafkaProducer.send(
      KafkaTopic.PRODUCT_CREATED,
      {
        topic: KafkaTopic.PRODUCT_CREATED,
        payload: {
          productId: product.id,
          catalogVariantId: product.catalogVariantId,
          agentId: product.agentId,
          sku: product.sku,
          condition: product.condition,
          name: product.name,
          description: product.description,
          price: product.price,
          comparePrice: product.comparePrice,
          categoryId: product.categoryId,
          brand: product.brand,
          tags: product.tags,
          images: product.images,
          initialStock: 0,
        },
      },
      product.id,
    );

  }

  async getById(id: string): Promise<ProductReadModel> {
    const product = await this.readRepo.findById(id);
    if (!product || product.status !== ProductStatus.ACTIVE) throw new NotFoundError('Product', id);
    return product;
  }

  async list(query: ProductListQueryDto): Promise<{ products: ProductReadModel[]; total: number }> {
    return this.readRepo.findMany(query);
  }

  async update(id: string, dto: UpdateProductDto, agentId: string): Promise<void> {
    const product = await this.writeRepo.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    if (product.agentId !== agentId) throw new ForbiddenError('You do not own this product');
    if (product.status === ProductStatus.INACTIVE) throw new ConflictError('Inactive products cannot be updated');

    const updated = await this.writeRepo.update(id, agentId, dto);
    if (!updated) throw new ConflictError('Product could not be updated in its current state');
    await this.readRepo.invalidateCache(id);

    await this.kafkaProducer.send(
      KafkaTopic.PRODUCT_UPDATED,
      {
        topic: KafkaTopic.PRODUCT_UPDATED,
        payload: { productId: id, agentId, changes: {
          name: updated.name, description: updated.description, price: updated.price,
          comparePrice: updated.comparePrice, categoryId: updated.categoryId, brand: updated.brand,
          tags: updated.tags, images: updated.images, status: ProductStatus.PENDING_APPROVAL,
        } },
      },
      id,
    );
  }

  async approve(id: string, approvedBy: string): Promise<void> {
    const existing = await this.writeRepo.findById(id);
    if (!existing) throw new NotFoundError('Product', id);
    if (existing.status === ProductStatus.ACTIVE) {
      await this.publishApproved(existing, approvedBy);
      return;
    }
    if (existing.status !== ProductStatus.PENDING_APPROVAL) {
      throw new ConflictError(`Cannot approve a product in ${existing.status} status`);
    }
    const product = await this.writeRepo.approve(id, approvedBy);
    if (!product) throw new ConflictError('Product approval state changed concurrently');
    await this.readRepo.invalidateCache(id);

    await this.publishApproved(product, approvedBy);
  }

  private async publishApproved(product: Awaited<ReturnType<ProductWriteRepository['create']>>, approvedBy: string): Promise<void> {
    await this.kafkaProducer.send(
      KafkaTopic.PRODUCT_APPROVED,
      { topic: KafkaTopic.PRODUCT_APPROVED, payload: {
        productId: product.id,
        catalogVariantId: product.catalogVariantId,
        agentId: product.agentId,
        sku: product.sku,
        condition: product.condition,
        name: product.name,
        description: product.description,
        price: product.price,
        comparePrice: product.comparePrice,
        categoryId: product.categoryId,
        brand: product.brand,
        tags: product.tags,
        images: product.images,
        approvedBy,
      } },
      product.id,
    );
  }

  async reject(id: string, approvedBy: string, dto: RejectProductDto): Promise<void> {
    const existing = await this.writeRepo.findById(id);
    if (!existing) throw new NotFoundError('Product', id);
    if (existing.status === ProductStatus.REJECTED) {
      if (existing.rejectionReason !== dto.reason) throw new ConflictError('Product was already rejected for a different reason');
      await this.publishRejected(existing.id, existing.agentId, approvedBy, dto.reason);
      return;
    }
    if (existing.status !== ProductStatus.PENDING_APPROVAL) {
      throw new ConflictError(`Cannot reject a product in ${existing.status} status`);
    }
    const product = await this.writeRepo.reject(id, approvedBy, dto.reason);
    if (!product) throw new ConflictError('Product rejection state changed concurrently');
    await this.readRepo.invalidateCache(id);

    await this.publishRejected(id, product.agentId, approvedBy, dto.reason);
  }

  private async publishRejected(id: string, agentId: string, approvedBy: string, reason: string): Promise<void> {
    await this.kafkaProducer.send(
      KafkaTopic.PRODUCT_REJECTED,
      { topic: KafkaTopic.PRODUCT_REJECTED, payload: { productId: id, agentId, approvedBy, reason } },
      id,
    );
  }

  async delete(id: string, agentId: string): Promise<void> {
    const existing = await this.writeRepo.findById(id);
    if (!existing) throw new NotFoundError('Product', id);
    if (existing.agentId !== agentId) throw new ForbiddenError('You do not own this product');
    await this.deleteExisting(existing, () => this.writeRepo.softDelete(id, agentId));
  }

  async deleteAny(id: string): Promise<void> {
    const existing = await this.writeRepo.findById(id);
    if (!existing) throw new NotFoundError('Product', id);
    await this.deleteExisting(existing, () => this.writeRepo.softDeleteAny(id));
  }

  private async deleteExisting(existing: Awaited<ReturnType<ProductWriteRepository['findById']>> & {}, write: () => Promise<boolean>): Promise<void> {
    if (existing.status !== ProductStatus.INACTIVE) {
      const deleted = await write();
      if (!deleted) throw new ConflictError('Product deletion state changed concurrently');
    }
    // Repeat invalidation and publication on replay. A prior attempt may have
    // committed PostgreSQL but failed before either downstream repair step.
    await this.readRepo.invalidateCache(existing.id);
    await this.publishDeleted(existing.id, existing.agentId);
  }

  private async publishDeleted(id: string, agentId: string): Promise<void> {
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

import { AnyBulkWriteOperation, Collection, Document } from 'mongodb';
import pLimit from 'p-limit';
import { KafkaTopic } from '@ecommerce/shared';

export interface ProjectionEvent {
  topic: string;
  event: { payload: any; occurredAt?: string };
}

export interface ProjectionDependencies {
  products: Collection;
  orders: Collection;
  users: Collection;
  deliveries: Collection;
  agentsSearch: {
    index(request: { index: string; id: string; body: Record<string, unknown>; refresh: boolean }): Promise<unknown>;
    update(request: { index: string; id: string; body: Record<string, unknown>; refresh: boolean }, options?: { ignore?: number[] }): Promise<unknown>;
  };
  agentIndex: string;
  userIndex: string;
  redis: { del(key: string): Promise<unknown> };
}

export async function projectBatch(
  dependencies: ProjectionDependencies,
  events: ProjectionEvent[],
  concurrency = 8,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) throw new Error('Projection concurrency must be a positive integer');

  const productOps: AnyBulkWriteOperation<Document>[] = [];
  const orderOps: AnyBulkWriteOperation<Document>[] = [];
  const userOps: AnyBulkWriteOperation<Document>[] = [];
  const deliveryOps: AnyBulkWriteOperation<Document>[] = [];
  const searchOps: Array<() => Promise<unknown>> = [];
  const invalidations = new Set<string>();

  for (const { topic, event } of events) {
    const p = event.payload;
    switch (topic) {
      case KafkaTopic.USER_REGISTERED:
        userOps.push({ updateOne: {
          filter: { _id: p.userId },
          update: { $set: { _id: p.userId, email: p.email, role: p.role, isActive: true, firstName: p.firstName, lastName: p.lastName } },
          upsert: true,
        } });
        searchOps.push(() => dependencies.agentsSearch.index({
          index: dependencies.userIndex,
          id: p.userId,
          body: { userId: p.userId, email: p.email, role: p.role, isActive: true, firstName: p.firstName, lastName: p.lastName, registeredAt: event.occurredAt },
          refresh: true,
        }));
        break;
      case KafkaTopic.USER_ROLE_CHANGED:
        userOps.push({ updateOne: { filter: { _id: p.userId }, update: { $set: { role: p.role } } } });
        searchOps.push(() => dependencies.agentsSearch.update({
          index: dependencies.userIndex,
          id: p.userId,
          body: { doc: { role: p.role } },
          refresh: true,
        }, { ignore: [404] }));
        break;
      case KafkaTopic.USER_STATUS_CHANGED:
        userOps.push({ updateOne: { filter: { _id: p.userId }, update: { $set: { isActive: p.isActive } } } });
        searchOps.push(() => dependencies.agentsSearch.update({
          index: dependencies.userIndex,
          id: p.userId,
          body: { doc: { isActive: p.isActive } },
          refresh: true,
        }, { ignore: [404] }));
        break;
      case KafkaTopic.AGENT_APPROVED:
        searchOps.push(() => dependencies.agentsSearch.index({
          index: dependencies.agentIndex,
          id: p.agentId,
          body: {
            agentId: p.agentId,
            userId: p.userId,
            businessName: p.businessName,
            status: 'APPROVED',
            approvedAt: event.occurredAt,
          },
          refresh: true,
        }));
        break;
      case KafkaTopic.PRODUCT_CREATED:
      case KafkaTopic.PRODUCT_APPROVED:
        productOps.push({ updateOne: {
          filter: { _id: p.productId },
          update: {
            $set: {
              _id: p.productId, catalogVariantId: p.catalogVariantId, agentId: p.agentId,
              sku: p.sku, condition: p.condition, name: p.name, price: p.price,
              categoryId: p.categoryId, brand: p.brand, tags: p.tags,
              description: p.description, comparePrice: p.comparePrice, images: p.images,
              ...(topic === KafkaTopic.PRODUCT_CREATED ? { stock: p.initialStock ?? 0 } : {}),
              status: topic === KafkaTopic.PRODUCT_APPROVED ? 'ACTIVE' : 'PENDING_APPROVAL',
            },
            $setOnInsert: { rating: { average: 0, count: 0 }, viewCount: 0 },
          },
          upsert: true,
        } });
        invalidations.add(`product:${p.productId}`);
        break;
      case KafkaTopic.PRODUCT_UPDATED:
        productOps.push({ updateOne: { filter: { _id: p.productId }, update: { $set: p.changes } } });
        invalidations.add(`product:${p.productId}`);
        break;
      case KafkaTopic.PRODUCT_DELETED:
      case KafkaTopic.PRODUCT_REJECTED:
        productOps.push({ updateOne: {
          filter: { _id: p.productId },
          update: { $set: { status: topic === KafkaTopic.PRODUCT_DELETED ? 'INACTIVE' : 'REJECTED' } },
        } });
        invalidations.add(`product:${p.productId}`);
        break;
      case KafkaTopic.INVENTORY_UPDATED:
        productOps.push({ updateOne: { filter: { _id: p.productId }, update: { $set: { stock: p.available } } } });
        invalidations.add(`product:${p.productId}`);
        break;
      case KafkaTopic.INVENTORY_DEDUCTED:
        for (const item of p.items ?? []) {
          productOps.push({ updateOne: { filter: { _id: item.productId }, update: { $set: { stock: item.available } } } });
          invalidations.add(`product:${item.productId}`);
        }
        break;
      case KafkaTopic.REVIEW_RATING_UPDATED:
        productOps.push({ updateOne: {
          filter: { _id: p.productId },
          update: { $set: { rating: { average: p.average, count: p.count } } },
        } });
        invalidations.add(`product:${p.productId}`);
        break;
      case KafkaTopic.ORDER_CREATED:
        orderOps.push({ updateOne: {
          filter: { _id: p.orderId },
          update: { $set: {
            _id: p.orderId, userId: p.userId, status: 'PENDING', items: p.items,
            totalAmount: p.totalAmount, shippingFee: p.shippingFee, discountAmount: p.discountAmount ?? 0,
            finalAmount: p.finalAmount, createdAt: event.occurredAt,
          } },
          upsert: true,
        } });
        break;
      case KafkaTopic.ORDER_STATUS_CHANGED:
        orderOps.push({ updateOne: { filter: { _id: p.orderId }, update: { $set: { status: p.status } } } });
        break;
      case KafkaTopic.PAYMENT_COMPLETED:
        orderOps.push({ updateOne: { filter: { _id: p.orderId }, update: { $set: { status: 'PAID', paymentId: p.paymentId } } } });
        break;
      case KafkaTopic.PAYMENT_REFUNDED:
        if (p.paymentStatus === 'REFUNDED') orderOps.push({ updateOne: { filter: { _id: p.orderId }, update: { $set: { status: 'REFUNDED' } } } });
        break;
      case KafkaTopic.ORDER_COMPLETED:
      case KafkaTopic.ORDER_CANCELLED:
        orderOps.push({ updateOne: {
          filter: { _id: p.orderId },
          update: { $set: { status: topic === KafkaTopic.ORDER_COMPLETED ? 'COMPLETED' : 'CANCELLED' } },
        } });
        break;
      case KafkaTopic.DELIVERY_SHIPPED:
        deliveryOps.push({ updateOne: {
          filter: { _id: p.deliveryGroupId },
          update: { $set: {
            _id: p.deliveryGroupId, orderId: p.orderId, userId: p.userId,
            agentId: p.agentId, status: 'SHIPPED', courierName: p.courierName,
            trackingNumber: p.trackingNumber, shippedAt: p.shippedAt,
          } },
          upsert: true,
        } });
        orderOps.push({ updateOne: {
          filter: { _id: p.orderId, status: { $nin: ['COMPLETED', 'CANCELLED', 'REFUNDED'] } },
          update: { $set: { status: p.totalGroups > 0 && p.shippedGroups >= p.totalGroups ? 'SHIPPED' : 'PARTIALLY_SHIPPED' } },
        } });
        break;
      case KafkaTopic.DELIVERY_GROUP_CREATED:
        deliveryOps.push({ updateOne: {
          filter: { _id: p.deliveryGroupId },
          update: { $setOnInsert: {
            _id: p.deliveryGroupId, orderId: p.orderId, agentId: p.agentId,
            items: p.items, shippingFee: p.shippingFee, status: 'PREPARING',
            createdAt: event.occurredAt,
          } },
          upsert: true,
        } });
        break;
      case KafkaTopic.DELIVERY_DELIVERED:
        deliveryOps.push({ updateOne: {
          filter: { _id: p.deliveryGroupId },
          update: { $set: { orderId: p.orderId, userId: p.userId, status: 'DELIVERED', deliveredAt: p.deliveredAt } },
          upsert: true,
        } });
        orderOps.push({ updateOne: { filter: { _id: p.orderId }, update: { $set: { lastDeliveredAt: event.occurredAt } } } });
        break;
    }
  }

  const limit = pLimit(concurrency);
  const writes: Array<Promise<unknown>> = [];
  if (productOps.length) writes.push(limit(() => dependencies.products.bulkWrite(productOps, { ordered: true })));
  if (orderOps.length) writes.push(limit(() => dependencies.orders.bulkWrite(orderOps, { ordered: true })));
  if (userOps.length) writes.push(limit(() => dependencies.users.bulkWrite(userOps, { ordered: true })));
  if (deliveryOps.length) writes.push(limit(() => dependencies.deliveries.bulkWrite(deliveryOps, { ordered: true })));
  for (const operation of searchOps) writes.push(limit(operation));
  await Promise.all(writes);

  // Invalidate only after durable projections finish. Deleting concurrently
  // with MongoDB writes allows an old read model to repopulate a stale cache.
  await Promise.all([...invalidations].map((key) => limit(() => dependencies.redis.del(key))));
}

import { v4 as uuidv4 } from 'uuid';
import { OrderRepository } from '../../domain/repositories/order.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { KafkaTopic, OrderStatus } from '@ecommerce/shared';
import { BadRequestError } from '@ecommerce/errors';
import { withTransaction } from '../../infrastructure/db/pool';
import { CreateOrderDto } from '../dtos/order.dto';
import { Order } from '../../domain/entities/order.entity';

// In production this would call product-service via HTTP
// For now we compute from order items passed in
interface ProductInfo {
  productId: string;
  agentId: string;
  productName: string;
  productImage?: string;
  unitPrice: number;
}

export class CreateOrderUseCase {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async execute(dto: CreateOrderDto, userId: string, productInfoMap: Map<string, ProductInfo>): Promise<Order> {
    if (dto.items.some((i) => !productInfoMap.has(i.productId))) {
      throw new BadRequestError('One or more products not found');
    }

    const orderId = uuidv4();
    const sagaId = uuidv4();

    const orderItems = dto.items.map((item) => {
      const info = productInfoMap.get(item.productId)!;
      const subtotal = info.unitPrice * item.quantity;
      return {
        orderId,
        productId: item.productId,
        agentId: info.agentId,
        productName: info.productName,
        productImage: info.productImage,
        quantity: item.quantity,
        unitPrice: info.unitPrice,
        subtotal,
      };
    });

    const totalAmount = orderItems.reduce((sum, i) => sum + i.subtotal, 0);
    const shippingFee = 0; // computed by delivery-service based on agent policies
    const discountAmount = 0;
    const finalAmount = totalAmount + shippingFee - discountAmount;

    return withTransaction(async (client) => {
      const order = await this.orderRepo.create(
        {
          id: orderId,
          sagaId,
          userId,
          status: OrderStatus.PENDING,
          shippingAddress: dto.shippingAddress,
          totalAmount,
          shippingFee,
          discountAmount,
          finalAmount,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        orderItems,
        client,
      );

      await this.orderRepo.createSaga(
        {
          sagaId,
          orderId,
          status: 'STARTED',
          items: orderItems.map((i) => ({ productId: i.productId, quantity: i.quantity, agentId: i.agentId })),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        client,
      );

      // Emit ORDER_CREATED → inventory-service will reserve stock
      await this.kafkaProducer.send(
        KafkaTopic.ORDER_CREATED,
        {
          topic: KafkaTopic.ORDER_CREATED,
          payload: {
            orderId: order.id,
            sagaId,
            userId,
            items: orderItems.map((i) => ({
              productId: i.productId,
              agentId: i.agentId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
            totalAmount: order.totalAmount,
            shippingAddress: dto.shippingAddress,
          },
        },
        sagaId,
      );

      return order;
    });
  }
}

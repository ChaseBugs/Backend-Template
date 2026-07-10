import amqplib, { ChannelModel, Channel, ConsumeMessage, Options } from 'amqplib';
import { Logger } from '@ecommerce/logger';

export interface RabbitMQConfig {
  url: string;
  heartbeat?: number;
}

export type ConsumeHandler = (msg: ConsumeMessage, channel: Channel) => Promise<void>;

export class RabbitMQClient {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: RabbitMQConfig,
    private readonly logger?: Logger,
  ) {}

  async connect(): Promise<void> {
    this.connection = await amqplib.connect(this.config.url, {
      heartbeat: this.config.heartbeat ?? 60,
    });

    this.connection.on('error', (err) => {
      this.logger?.error({ err }, 'RabbitMQ connection error');
      this.scheduleReconnect();
    });

    this.connection.on('close', () => {
      this.logger?.warn('RabbitMQ connection closed, reconnecting...');
      this.scheduleReconnect();
    });

    this.channel = await this.connection.createChannel();
    this.channel.on('error', (err) => this.logger?.error({ err }, 'RabbitMQ channel error'));

    this.logger?.info('RabbitMQ connected');
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.connect();
      } catch (err) {
        this.logger?.error({ err }, 'RabbitMQ reconnect failed');
        this.scheduleReconnect();
      }
    }, 5000);
  }

  getChannel(): Channel {
    if (!this.channel) throw new Error('RabbitMQ channel not initialized');
    return this.channel;
  }

  async assertExchange(exchange: string, type: 'direct' | 'topic' | 'fanout', options?: Options.AssertExchange): Promise<void> {
    await this.getChannel().assertExchange(exchange, type, { durable: true, ...options });
  }

  async assertQueue(queue: string, options?: Options.AssertQueue): Promise<void> {
    await this.getChannel().assertQueue(queue, { durable: true, ...options });
  }

  async bindQueue(queue: string, exchange: string, routingKey: string): Promise<void> {
    await this.getChannel().bindQueue(queue, exchange, routingKey);
  }

  async publish(exchange: string, routingKey: string, message: object): Promise<boolean> {
    const content = Buffer.from(JSON.stringify(message));
    return this.getChannel().publish(exchange, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
      timestamp: Date.now(),
    });
  }

  async sendToQueue(queue: string, message: object): Promise<boolean> {
    const content = Buffer.from(JSON.stringify(message));
    return this.getChannel().sendToQueue(queue, content, {
      persistent: true,
      contentType: 'application/json',
    });
  }

  async consume(queue: string, handler: ConsumeHandler, prefetch = 10): Promise<void> {
    const channel = this.getChannel();
    await channel.prefetch(prefetch);
    await channel.consume(queue, async (msg) => {
      if (!msg) return;
      try {
        await handler(msg, channel);
        channel.ack(msg);
      } catch (err) {
        this.logger?.error({ err, queue }, 'Error processing RabbitMQ message');
        channel.nack(msg, false, false); // dead-letter
      }
    });
  }

  parseMessage<T>(msg: ConsumeMessage): T {
    return JSON.parse(msg.content.toString()) as T;
  }

  async close(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    await this.channel?.close();
    await this.connection?.close();
    this.logger?.info('RabbitMQ connection closed');
  }
}

export { ConsumeMessage, Channel };

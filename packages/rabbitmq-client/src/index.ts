import amqplib, { ChannelModel, Channel, ConfirmChannel, ConsumeMessage, Options } from 'amqplib';
import { Logger } from '@ecommerce/logger';

export interface RabbitMQConfig {
  url: string;
  heartbeat?: number;
}

export type ConsumeHandler = (msg: ConsumeMessage, channel: Channel) => Promise<void>;

export class RabbitMQClient {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private closing = false;
  private connectPromise: Promise<void> | null = null;
  private readonly exchanges = new Map<string, { type: 'direct' | 'topic' | 'fanout'; options?: Options.AssertExchange }>();
  private readonly queues = new Map<string, Options.AssertQueue | undefined>();
  private readonly bindings = new Map<string, { queue: string; exchange: string; routingKey: string }>();
  private readonly consumers = new Map<string, { handler: ConsumeHandler; prefetch: number; maxRetries: number }>();

  constructor(
    private readonly config: RabbitMQConfig,
    private readonly logger?: Logger,
  ) {}

  async connect(): Promise<void> {
    if (this.isReady()) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.openConnection();
    try { await this.connectPromise; } finally { this.connectPromise = null; }
  }

  private async openConnection(): Promise<void> {
    this.closing = false;
    const connection = await amqplib.connect(this.config.url, {
      heartbeat: this.config.heartbeat ?? 60,
    });
    this.connection = connection;

    connection.on('error', (err) => {
      this.logger?.error({ err }, 'RabbitMQ connection error');
      this.channel = null;
      if (this.connection === connection) this.connection = null;
      this.scheduleReconnect();
    });

    connection.on('close', () => {
      this.logger?.warn('RabbitMQ connection closed, reconnecting...');
      this.channel = null;
      if (this.connection === connection) this.connection = null;
      this.scheduleReconnect();
    });

    const channel = await connection.createConfirmChannel();
    this.channel = channel;
    const invalidateChannel = () => {
      if (this.channel === channel) this.channel = null;
      if (!this.closing && this.connection === connection) {
        void connection.close().catch((err) => this.logger?.error({ err }, 'RabbitMQ connection close after channel failure failed'));
      }
      this.scheduleReconnect();
    };
    channel.on('error', (err) => {
      this.logger?.error({ err }, 'RabbitMQ channel error');
      invalidateChannel();
    });
    channel.on('close', invalidateChannel);

    try {
      await this.restoreTopology(channel);
    } catch (error) {
      if (this.channel === channel) this.channel = null;
      await connection.close().catch(() => undefined);
      throw error;
    }

    this.logger?.info('RabbitMQ connected');
  }

  private async restoreTopology(channel: ConfirmChannel): Promise<void> {
    for (const [exchange, definition] of this.exchanges) {
      await channel.assertExchange(exchange, definition.type, { durable: true, ...definition.options });
    }
    for (const [queue, options] of this.queues) {
      await channel.assertQueue(queue, { durable: true, ...options });
    }
    for (const binding of this.bindings.values()) {
      await channel.bindQueue(binding.queue, binding.exchange, binding.routingKey);
    }
    for (const [queue, registration] of this.consumers) {
      await this.startConsumer(channel, queue, registration);
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimeout) return;
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
    this.exchanges.set(exchange, { type, options });
    await this.getChannel().assertExchange(exchange, type, { durable: true, ...options });
  }

  async assertQueue(queue: string, options?: Options.AssertQueue): Promise<void> {
    this.queues.set(queue, options);
    await this.getChannel().assertQueue(queue, { durable: true, ...options });
  }

  async bindQueue(queue: string, exchange: string, routingKey: string): Promise<void> {
    this.bindings.set(`${queue}\u0000${exchange}\u0000${routingKey}`, { queue, exchange, routingKey });
    await this.getChannel().bindQueue(queue, exchange, routingKey);
  }

  async publish(exchange: string, routingKey: string, message: object): Promise<boolean> {
    const content = Buffer.from(JSON.stringify(message));
    const channel = this.getChannel() as ConfirmChannel;
    return new Promise<boolean>((resolve, reject) => {
      const accepted = channel.publish(exchange, routingKey, content, {
        persistent: true,
        contentType: 'application/json',
        timestamp: Date.now(),
      }, (error) => error ? reject(error) : resolve(accepted));
    });
  }

  isReady(): boolean {
    return !this.closing && this.connection !== null && this.channel !== null;
  }

  async sendToQueue(queue: string, message: object): Promise<boolean> {
    const content = Buffer.from(JSON.stringify(message));
    const channel = this.getChannel() as ConfirmChannel;
    return new Promise<boolean>((resolve, reject) => {
      const accepted = channel.sendToQueue(queue, content, {
        persistent: true,
        contentType: 'application/json',
      }, (error) => error ? reject(error) : resolve(accepted));
    });
  }

  async consume(queue: string, handler: ConsumeHandler, prefetch = 10, maxRetries = 3): Promise<void> {
    const registration = { handler, prefetch, maxRetries };
    this.consumers.set(queue, registration);
    await this.startConsumer(this.getChannel() as ConfirmChannel, queue, registration);
  }

  private async startConsumer(
    channel: ConfirmChannel,
    queue: string,
    registration: { handler: ConsumeHandler; prefetch: number; maxRetries: number },
  ): Promise<void> {
    await channel.prefetch(registration.prefetch);
    await channel.consume(queue, async (msg) => {
      if (!msg) return;
      try {
        await registration.handler(msg, channel);
        channel.ack(msg);
      } catch (err) {
        this.logger?.error({ err, queue }, 'Error processing RabbitMQ message');
        const retryCount = Number(msg.properties.headers?.['x-retry-count'] ?? 0);
        if (retryCount < registration.maxRetries) {
          try {
            await this.confirmRetry(channel, queue, msg, retryCount + 1);
            channel.ack(msg);
          } catch (publishError) {
            this.logger?.error({ err: publishError, queue }, 'RabbitMQ retry publish was not confirmed');
            channel.nack(msg, false, true);
          }
        } else {
          channel.nack(msg, false, false); // dead-letter after bounded retries
        }
      }
    });
  }

  private confirmRetry(channel: ConfirmChannel, queue: string, msg: ConsumeMessage, retryCount: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      channel.sendToQueue(queue, msg.content, {
        ...msg.properties,
        persistent: true,
        headers: { ...msg.properties.headers, 'x-retry-count': retryCount },
      }, (error) => error ? reject(error) : resolve());
    });
  }

  parseMessage<T>(msg: ConsumeMessage): T {
    return JSON.parse(msg.content.toString()) as T;
  }

  async close(): Promise<void> {
    this.closing = true;
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

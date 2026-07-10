import { Kafka, Consumer, EachMessagePayload, ConsumerSubscribeTopics } from 'kafkajs';
import { Logger } from '@ecommerce/logger';

export type MessageHandler = (payload: EachMessagePayload) => Promise<void>;

export interface ConsumerConfig {
  groupId: string;
  topics: string[];
  fromBeginning?: boolean;
}

export class KafkaConsumer {
  private consumer: Consumer;
  private connected = false;

  constructor(
    private readonly kafka: Kafka,
    config: ConsumerConfig,
    private readonly logger?: Logger,
  ) {
    this.consumer = kafka.consumer({
      groupId: config.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: 1000,
    });
  }

  async connect(topics: ConsumerSubscribeTopics): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe(topics);
    this.connected = true;
    this.logger?.info({ topics: topics.topics }, 'Kafka consumer connected and subscribed');
  }

  async run(handler: MessageHandler): Promise<void> {
    await this.consumer.run({
      autoCommit: false,
      eachMessage: async (payload) => {
        const { topic, partition, message } = payload;
        try {
          await handler(payload);
          await this.consumer.commitOffsets([
            { topic, partition, offset: (BigInt(message.offset) + BigInt(1)).toString() },
          ]);
        } catch (err) {
          this.logger?.error({ err, topic, partition, offset: message.offset }, 'Error processing Kafka message');
          throw err;
        }
      },
    });
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.consumer.disconnect();
      this.connected = false;
      this.logger?.info('Kafka consumer disconnected');
    }
  }

  parseMessage<T>(payload: EachMessagePayload): T {
    const value = payload.message.value?.toString();
    if (!value) throw new Error('Empty Kafka message');
    return JSON.parse(value) as T;
  }
}

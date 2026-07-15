import { Kafka, Consumer, EachMessagePayload, ConsumerSubscribeTopics, Producer } from 'kafkajs';
import { Logger } from '@ecommerce/logger';
import { validateKafkaEvent } from './event-schema';

export type MessageHandler = (payload: EachMessagePayload) => Promise<void>;
export type BatchMessageHandler = (payloads: EachMessagePayload[]) => Promise<void>;

export interface ConsumerConfig {
  groupId: string;
  topics: string[];
  fromBeginning?: boolean;
  dlqTopic?: string;
  maxRetries?: number;
}

export class KafkaConsumer {
  private consumer: Consumer;
  private connected = false;
  private dlqProducer?: Producer;
  private readonly dlqTopic?: string;
  private readonly maxRetries: number;
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly kafka: Kafka,
    config: ConsumerConfig,
    private readonly logger?: Logger,
  ) {
    this.dlqTopic = config.dlqTopic;
    this.maxRetries = config.maxRetries ?? 3;
    if (this.dlqTopic) this.dlqProducer = kafka.producer({ allowAutoTopicCreation: false });
    this.consumer = kafka.consumer({
      groupId: config.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: 1000,
    });
  }

  async connect(topics: ConsumerSubscribeTopics): Promise<void> {
    await this.consumer.connect();
    await this.dlqProducer?.connect();
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
          const attemptKey = `${topic}:${partition}:${message.offset}`;
          const attempt = (this.attempts.get(attemptKey) ?? 0) + 1;
          this.attempts.set(attemptKey, attempt);
          this.logger?.error({ err, topic, partition, offset: message.offset, attempt }, 'Error processing Kafka message');

          if (this.dlqTopic && this.dlqProducer && attempt >= this.maxRetries) {
            await this.dlqProducer.send({
              topic: this.dlqTopic,
              messages: [{
                key: message.key,
                value: message.value,
                headers: {
                  'source-topic': topic,
                  'source-partition': String(partition),
                  'source-offset': message.offset,
                  'retry-count': String(attempt),
                  'error-message': err instanceof Error ? err.message : String(err),
                },
              }],
            });
            await this.consumer.commitOffsets([
              { topic, partition, offset: (BigInt(message.offset) + BigInt(1)).toString() },
            ]);
            this.attempts.delete(attemptKey);
            this.logger?.warn({ topic, partition, offset: message.offset, dlqTopic: this.dlqTopic }, 'Kafka message moved to DLQ');
            return;
          }
          throw err;
        }
      },
    });
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.consumer.disconnect();
      await this.dlqProducer?.disconnect();
      this.connected = false;
      this.logger?.info('Kafka consumer disconnected');
    }
  }

  /**
   * Processes one Kafka topic/partition batch as a unit. Offsets are committed
   * only after the complete handler succeeds, so a projection can safely use
   * database bulk writes without acknowledging unpersisted messages.
   */
  async runBatch(handler: BatchMessageHandler): Promise<void> {
    await this.consumer.run({
      autoCommit: false,
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, heartbeat, isRunning, isStale }) => {
        if (!isRunning() || isStale() || batch.messages.length === 0) return;
        const { topic, partition } = batch;
        const firstOffset = batch.messages[0].offset;
        const lastOffset = batch.messages[batch.messages.length - 1].offset;
        const attemptKey = `${topic}:${partition}:${firstOffset}-${lastOffset}`;
        const payloads = batch.messages.map((message) => ({ topic, partition, message, heartbeat, pause: () => () => undefined }));

        try {
          await heartbeat();
          await handler(payloads);
          await this.consumer.commitOffsets([
            { topic, partition, offset: (BigInt(lastOffset) + BigInt(1)).toString() },
          ]);
          this.attempts.delete(attemptKey);
          await heartbeat();
        } catch (err) {
          const attempt = (this.attempts.get(attemptKey) ?? 0) + 1;
          this.attempts.set(attemptKey, attempt);
          this.logger?.error({ err, topic, partition, firstOffset, lastOffset, attempt }, 'Error processing Kafka batch');

          if (this.dlqTopic && this.dlqProducer && attempt >= this.maxRetries) {
            await this.dlqProducer.send({
              topic: this.dlqTopic,
              messages: batch.messages.map((message) => ({
                key: message.key,
                value: message.value,
                headers: {
                  'source-topic': topic,
                  'source-partition': String(partition),
                  'source-offset': message.offset,
                  'retry-count': String(attempt),
                  'error-message': err instanceof Error ? err.message : String(err),
                },
              })),
            });
            await this.consumer.commitOffsets([
              { topic, partition, offset: (BigInt(lastOffset) + BigInt(1)).toString() },
            ]);
            this.attempts.delete(attemptKey);
            this.logger?.warn({ topic, partition, firstOffset, lastOffset, dlqTopic: this.dlqTopic }, 'Kafka batch moved to DLQ');
            return;
          }
          throw err;
        }
      },
    });
  }

  isReady(): boolean {
    return this.connected;
  }

  parseMessage<T>(payload: EachMessagePayload): T {
    const value = payload.message.value?.toString();
    if (!value) throw new Error('Empty Kafka message');
    const parsed = JSON.parse(value) as T;
    validateKafkaEvent(parsed, payload.topic);
    return parsed;
  }
}

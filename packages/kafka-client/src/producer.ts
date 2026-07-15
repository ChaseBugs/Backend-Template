import { Kafka, Producer, ProducerRecord, RecordMetadata, CompressionTypes } from 'kafkajs';
import { Logger } from '@ecommerce/logger';
import { BaseEvent, KafkaEvent, KafkaTopicValue } from '@ecommerce/shared';
import { randomUUID } from 'crypto';
import { validateKafkaEvent } from './event-schema';

export class KafkaProducer {
  private producer: Producer;
  private connected = false;

  constructor(
    private readonly kafka: Kafka,
    private readonly logger?: Logger,
  ) {
    this.producer = kafka.producer({
      allowAutoTopicCreation: false,
      transactionTimeout: 30000,
    });
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    this.connected = true;
    this.logger?.info('Kafka producer connected');
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
      this.connected = false;
      this.logger?.info('Kafka producer disconnected');
    }
  }

  isReady(): boolean {
    return this.connected;
  }

  async send<T extends KafkaTopicValue>(
    topic: T,
    payload: Omit<Extract<KafkaEvent, { topic: T }>, 'eventId' | 'occurredAt' | 'version'>,
    key?: string,
    eventId: string = randomUUID(),
  ): Promise<RecordMetadata[]> {
    const event = {
      ...payload,
      eventId,
      occurredAt: new Date().toISOString(),
      version: 1,
    } as BaseEvent & typeof payload;
    validateKafkaEvent(event, topic);

    const record: ProducerRecord = {
      topic,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key: key ?? event.eventId,
          value: JSON.stringify(event),
          headers: {
            'event-id': event.eventId,
            'occurred-at': event.occurredAt,
          },
        },
      ],
    };

    const result = await this.producer.send(record);
    this.logger?.debug({ topic, key, eventId: event.eventId }, 'Kafka message sent');
    return result;
  }

  async sendBatch(records: ProducerRecord[]): Promise<RecordMetadata[]> {
    const result = await this.producer.sendBatch({ topicMessages: records });
    this.logger?.debug({ count: records.length }, 'Kafka batch sent');
    return result;
  }
}

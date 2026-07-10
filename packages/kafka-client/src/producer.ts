import { Kafka, Producer, ProducerRecord, RecordMetadata, CompressionTypes } from 'kafkajs';
import { Logger } from '@ecommerce/logger';
import { BaseEvent } from '@ecommerce/shared';
import { randomUUID } from 'crypto';

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

  async send<T extends Omit<BaseEvent, 'eventId' | 'occurredAt' | 'version'>>(
    topic: string,
    payload: T,
    key?: string,
  ): Promise<RecordMetadata[]> {
    const event: BaseEvent & T = {
      ...payload,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      version: 1,
    };

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

import { Kafka, KafkaConfig, logLevel } from 'kafkajs';
import { Logger } from '@ecommerce/logger';

export interface KafkaFactoryConfig {
  clientId: string;
  brokers: string[];
  logger?: Logger;
}

export function createKafka(config: KafkaFactoryConfig): Kafka {
  return new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
    logLevel: logLevel.WARN,
    retry: {
      initialRetryTime: 100,
      retries: 8,
    },
  } as KafkaConfig);
}

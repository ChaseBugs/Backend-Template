import { MongoClient, Collection } from 'mongodb';
import { config } from '../../config';
import { ProductReadModel } from '../../domain/entities/product.entity';

let client: MongoClient;

export async function connectMongo(): Promise<MongoClient> {
  client = new MongoClient(config.mongodb.uri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  return client;
}

export function getProductCollection(): Collection<ProductReadModel> {
  return client.db(config.mongodb.dbName).collection<ProductReadModel>('products');
}

export async function closeMongo(): Promise<void> {
  await client?.close();
}

import mongoose from 'mongoose';
import { env } from '../config/env.js';

export async function initMongo() {
  mongoose.set('strictQuery', true);
  console.log('Connecting to MongoDB...');
  await mongoose.connect(env.MONGO_URI!, {
    dbName: "vaani_dev",
  });
  console.log('Connected to MongoDB');
}

export async function closeMongo() {
  await mongoose.connection.close(false);
}


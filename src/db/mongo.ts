import mongoose from 'mongoose';
import { env } from '../config/env';

export async function initMongo() {
  mongoose.set('strictQuery', true);
  console.log('Connecting to MongoDB...');
  await mongoose.connect(env.MONGO_URI);
  console.log('Connected to MongoDB');
}

export async function closeMongo() {
  await mongoose.connection.close(false);
}


import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initMongo } from './db/mongo.js';
import { env } from './config/env.js';
import ingestRouter from './http/ingest.routes.js';

// centralized logger provides consistent formatting

async function main() {
  await initMongo();
  const app = express();
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json({ limit: '5mb' }));

  // Set a higher timeout for all requests (e.g., 10 minutes)
  app.use((req, res, next) => {
    res.setTimeout(600000); 
    next();
  });

  app.use('/api/ingest', ingestRouter);

  app.listen(env.PORT, () => {
    console.log(`HTTP server listening on ${env.PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});



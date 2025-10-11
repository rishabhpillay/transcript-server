
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: { uid: string }; // Changed from string to an object with uid
    }
  }
}

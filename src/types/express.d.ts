
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: string; // Or whatever type your user object is
    }
  }
}

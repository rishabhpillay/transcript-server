import { Request, Response, NextFunction } from 'express';
import { notifyDiscord } from '../utils/notifyDiscord.js';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, originalUrl, body, query } = req;

  // 1. Console Log Request
  console.log(`[REQ] ${method} ${originalUrl}`, { body, query });

  // 2. Notify Discord of incoming request (optional, usually verbose, but requested "notifyDiscord across all APIs")
  // Using 'info' or a custom 'request' type logic if available, fitting into 'info' for now.
  notifyDiscord({
    type: 'info',
    title: `Incoming Request: ${method} ${originalUrl}`,
    message: `Received ${method} request at ${originalUrl}`,
    meta: {
      body: JSON.stringify(body),
      query: JSON.stringify(query),
    },
    req,
  });

  // Intercept Response to log the result
  // We hook into res.send and res.json to capture the body before sending
  const originalSend = res.send;
  const originalJson = res.json;

  // Helper to log response
  const logResponse = (statusCode: number, responseBody: any) => {
    const duration = Date.now() - start;
    console.log(`[RES] ${method} ${originalUrl} ${statusCode} (${duration}ms)`, responseBody);

    const isError = statusCode >= 400;
    
    notifyDiscord({
      type: isError ? 'error' : 'success',
      title: `Response: ${statusCode} ${method} ${originalUrl}`,
      message: `Completed in ${duration}ms`,
      meta: {
        statusCode,
        duration: `${duration}ms`,
        body: typeof responseBody === 'object' ? JSON.stringify(responseBody) : responseBody,
      },
      req,
    });
  };

  res.send = function (body) {
    // Only capture if we haven't already (sometimes json calls send)
    // But overriding both is safer to catch all cases.
    // If body is an object, res.send might treat it as json, but typically res.json calls res.send.
    // To avoid double logging, we can check if it's already logged or just hook 'finish' event.
    // Hooking 'finish' is better for status code, but capturing body requires override.
    
    // We'll execute the log logic here
    logResponse(res.statusCode, body);
    return originalSend.call(this, body);
  };

  res.json = function (body) {
    logResponse(res.statusCode, body);
    return originalJson.call(this, body);
  };

  next();
};

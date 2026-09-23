import type { Request, Response, NextFunction, RequestHandler } from "express";

// Express 4 does not forward rejected promises from async handlers to
// next(err) automatically — an unhandled rejection in an `async (req,res)`
// route handler just hangs or crashes the process instead of reaching the
// global JSON error handler in index.ts. Wrapping a handler in asyncHandler
// ensures any thrown/rejected error is passed to next(), so the client
// always gets a clean { error } JSON response instead of a hung request or
// an ugly raw stack trace.
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

const WINDOW_MS = 60_000;
const windows = new Map<string, { count: number; windowStart: number }>();

// Simple in-memory sliding-window limiter keyed by token, not IP — appropriate for
// a single-instance, small-team deployment. Blunts automated abuse of a leaked token
// without needing an external store.
export function rateLimitByToken(keyFn: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    if (!key) return next();

    const now = Date.now();
    const entry = windows.get(key);
    if (!entry || now - entry.windowStart > WINDOW_MS) {
      windows.set(key, { count: 1, windowStart: now });
      return next();
    }

    entry.count += 1;
    if (entry.count > config.rateLimitPerMinute) {
      res.status(429).json({ error: "rate limit exceeded, slow down" });
      return;
    }
    next();
  };
}

export function bearerToken(req: Request): string | undefined {
  const auth = req.header("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
}

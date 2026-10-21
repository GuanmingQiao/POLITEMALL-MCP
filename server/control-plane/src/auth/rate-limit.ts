import type { IncomingHttpHeaders } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { config } from "../utils/config.js";

const WINDOW_MS = 60_000;
const windows = new Map<string, { count: number; windowStart: number }>();

// Simple in-memory fixed-window counter: true while `key` has made at most `limit` calls in the
// current `windowMs`. Appropriate for a single-instance, small-team deployment; blunts abuse
// without needing an external store.
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const entry = windows.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    return limit >= 1;
  }
  entry.count += 1;
  return entry.count <= limit;
}

export function resetRateLimitsForTests(): void {
  windows.clear();
}

// Keyed by token (or whatever `keyFn` returns, such as an IP).
export function rateLimitByToken(keyFn: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    if (!key) return next();
    if (!allow(key, config.rateLimitPerMinute, WINDOW_MS)) {
      res.status(429).json({ error: "rate limit exceeded, slow down" });
      return;
    }
    next();
  };
}

// The client's address as Caddy saw it. Caddy is the one trusted hop and appends the address it
// received the connection from, so the last X-Forwarded-For entry is the real client and any
// entries a client put before it are ignored. Falls back to the socket address when the header is
// absent (local runs, tests).
export function clientIp(req: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string } }): string {
  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : header;
  const last = raw?.split(",").pop()?.trim();
  return last || req.socket.remoteAddress || "unknown";
}

// Accepts both "Authorization: Bearer <token>" and a bare "Authorization: <token>" —
// some clients (e.g. Copilot Studio's API-key connection field) send whatever raw
// string you configure with no way to guarantee a "Bearer " prefix gets typed in.
export function bearerToken(req: Request): string | undefined {
  const auth = req.header("Authorization")?.trim();
  if (!auth) return undefined;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : auth;
}

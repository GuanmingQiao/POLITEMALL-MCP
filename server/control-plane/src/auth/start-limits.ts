import { config } from "../utils/config.js";
import { allow, resetRateLimitsForTests } from "./rate-limit.js";

// Per-IP limits on starting streamed browsers. A start is refused when the IP has used its budget
// for the window, or is paused because its recent sign-ins kept ending without success (viewer
// left, timed out, or sent no input). A successful sign-in clears the IP's strikes.

export type StartRefusal = { kind: "start" | "paused"; retryMs: number };

interface Strikes {
  count: number;
  first: number;
  pausedUntil: number;
}
const strikes = new Map<string, Strikes>();

export function checkStart(ip: string, now = Date.now()): StartRefusal | undefined {
  const s = strikes.get(ip);
  if (s && s.pausedUntil > now) return { kind: "paused", retryMs: s.pausedUntil - now };
  if (!allow(`start:${ip}`, config.signinStartsPerWindow, config.signinStartWindowMs, now)) {
    return { kind: "start", retryMs: config.signinStartWindowMs };
  }
  return undefined;
}

// A sign-in from this IP ended without success.
export function recordStrike(ip: string, now = Date.now()): void {
  let s = strikes.get(ip);
  if (!s || now - s.first > config.signinStartWindowMs) s = { count: 0, first: now, pausedUntil: 0 };
  s.count++;
  if (s.count >= config.signinStrikesBeforePause) {
    s.pausedUntil = now + config.signinPauseMs;
    s.count = 0;
    s.first = now;
  }
  strikes.set(ip, s);
  // Bounded: drop idle entries.
  if (strikes.size > 5000) for (const [k, v] of strikes) if (v.pausedUntil <= now && now - v.first > config.signinStartWindowMs) strikes.delete(k);
}

export function clearStrikes(ip: string): void {
  strikes.delete(ip);
}

export function refusalMessage(r: StartRefusal): string {
  const minutes = Math.max(1, Math.ceil(r.retryMs / 60_000));
  return `Too many sign-in attempts from your network. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export function resetStartLimitsForTests(): void {
  resetRateLimitsForTests();
  strikes.clear();
}

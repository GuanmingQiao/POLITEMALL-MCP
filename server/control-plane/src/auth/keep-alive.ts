import { SessionExpiredError, TokenRenewalError } from "../api/errors.js";
import { config } from "../utils/config.js";
import { auditLog } from "../utils/audit-log.js";
import type { D2LSchool } from "../types/schools.js";
import { RELOGIN_PAUSE_MS, refreshD2lSession } from "./d2l-session.js";
import { getSchoolSession, listSessionTargets } from "./session-vault.js";

// Keeps every stored D2L session alive by renewing it on a timer instead of only when its owner
// happens to use it. D2L sessions expire after sitting idle, and the browser that created one
// closes right after sign-in, so without this an unused session quietly dies and the next tool call
// has to climb the whole ladder (mint, silent re-login, sign-in link).
//
// Each session goes through exactly the renewal a tool call uses (d2l-session.ts), one at a time:
// a new token from the stored cookies, then a silent re-login if D2L says the session is dead,
// then lapse. Nothing is logged but counts.

export interface SweepSummary {
  seen: number;
  renewed: number;
  failed: number;
  transient: number;
  skipped: number;
}

export interface KeepAliveDeps {
  targets: () => { userId: string; school: D2LSchool }[];
  refresh: (userId: string, school: D2LSchool) => Promise<unknown>;
  paused: (userId: string, school: D2LSchool) => boolean;
  log: (event: string, fields: Record<string, unknown>) => void;
}

const defaults: KeepAliveDeps = {
  targets: () => listSessionTargets().filter((t): t is { userId: string; school: D2LSchool } => t.school === "politemall" || t.school === "nyp"),
  refresh: (userId, school) => refreshD2lSession(userId, school),
  // A session that just failed a silent re-login is left alone until its pause is over; refresh
  // would only answer "expired" without doing anything.
  paused: (userId, school) => isPaused(userId, school),
  log: auditLog,
};

let running = false;

// One pass over every stored session. Never throws; a failing session is counted and the pass
// moves on. A pass that starts while another is still running does nothing.
export async function runKeepAliveSweep(overrides: Partial<KeepAliveDeps> = {}): Promise<SweepSummary | null> {
  if (running) return null;
  running = true;
  const d = { ...defaults, ...overrides };
  const summary: SweepSummary = { seen: 0, renewed: 0, failed: 0, transient: 0, skipped: 0 };
  try {
    for (const { userId, school } of d.targets()) {
      summary.seen++;
      if (d.paused(userId, school)) {
        summary.skipped++;
        continue;
      }
      try {
        await d.refresh(userId, school);
        summary.renewed++;
      } catch (err) {
        if (err instanceof SessionExpiredError) summary.failed++;
        else if (err instanceof TokenRenewalError) summary.transient++;
        else summary.failed++;
      }
    }
    d.log("keepalive_sweep", { ...summary });
    return summary;
  } finally {
    running = false;
  }
}

// Starts the hourly sweep (first one shortly after boot). Called from index.ts only, so tests that
// import the app never start a timer. Returns a function that stops it.
export function startKeepAlive(intervalMs = config.keepAliveIntervalMs, firstDelayMs = 2 * 60 * 1000): () => void {
  const run = () => void runKeepAliveSweep().catch(() => undefined);
  const first = setTimeout(run, firstDelayMs);
  const every = setInterval(run, intervalMs);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

// Whether a stored session is inside its post-failure pause; kept here so the sweep's default
// skips what renewal would refuse anyway.
export function isPaused(userId: string, school: D2LSchool, now = Date.now(), pauseMs = RELOGIN_PAUSE_MS): boolean {
  const lapsedAt = getSchoolSession(userId, school)?.lapsedAt;
  return lapsedAt !== undefined && now - lapsedAt < pauseMs;
}

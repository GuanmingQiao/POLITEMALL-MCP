import { existsSync, readFileSync } from "node:fs";
import { config } from "../utils/config.js";
import { decrypt } from "./crypto.js";
import { d2lWhoami } from "../api/identity.js";
import * as step from "../api/step-client.js";
import type { School } from "../types/schools.js";
import { auditLog } from "../utils/audit-log.js";

interface TokenRecord {
  createdAt: string;
  expiresAt: string;
  encryptedCookies: Partial<Record<School, string>>;
}

function readStore(): Record<string, TokenRecord> {
  if (!existsSync(config.storeFile)) return {};
  try {
    return JSON.parse(readFileSync(config.storeFile, "utf-8"));
  } catch {
    return {};
  }
}

async function ping(school: School, cookieHeader: string): Promise<boolean> {
  try {
    if (school === "politemall" || school === "nyp") {
      await d2lWhoami(school, cookieHeader);
    } else {
      await step.whoami(cookieHeader);
    }
    return true;
  } catch {
    // Already expired or a transient failure — nothing to do here. The user
    // finds out (and is told to reconnect) the next time they actually use a
    // tool; a failed keep-alive ping isn't itself an error worth surfacing.
    return false;
  }
}

// D2L (and likely STEP) sessions use sliding expiry — any authenticated request
// resets the idle timer. Periodically touching each connected cookie keeps
// sessions alive across gaps in actual usage, so people reconnect less often.
export async function runKeepAliveSweep(): Promise<void> {
  const store = readStore();
  const now = Date.now();
  let pinged = 0;
  let failed = 0;

  for (const record of Object.values(store)) {
    if (new Date(record.expiresAt).getTime() < now) continue;

    for (const [school, encrypted] of Object.entries(record.encryptedCookies) as [School, string | undefined][]) {
      if (!encrypted) continue;
      let cookieHeader: string;
      try {
        cookieHeader = decrypt(encrypted);
      } catch {
        continue;
      }
      const ok = await ping(school, cookieHeader);
      if (ok) pinged++;
      else failed++;
    }
  }

  if (pinged > 0 || failed > 0) {
    auditLog("keepalive_sweep", { pinged, failed });
  }
}

export function startKeepAlive(): void {
  setInterval(() => void runKeepAliveSweep(), config.keepAliveIntervalMs);
}

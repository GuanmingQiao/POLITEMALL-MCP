import { randomBytes } from "node:crypto";
import { config } from "../utils/config.js";

// Pending streamed sign-ins. Each has an unguessable id that is the *only* thing that grants access
// to a browser view: it is not a token and carries no identity. A link works from the moment it is
// issued until its sign-in finishes, fails or times out (including reloads and reconnects while the
// sign-in is running, one viewer at a time), and never again after that, except to be told the
// outcome once if nobody was watching when it arrived.
//
// Held in memory on purpose: a sign-in lasts minutes, and a server restart simply invalidates
// open links (the user asks for a new one, and the refusal says the link is unknown).

// What the page is told when a sign-in ends; kept until it has been delivered to a viewer.
export type SigninOutcome = { type: "done"; redirect?: string; notice?: string } | { type: "fail"; reason: string };

// Why a link was refused, in the words the page uses.
export type LinkRefusal = "expired" | "finished" | "unknown";

export interface PendingSignin {
  id: string;
  // Set for a re-sign-in of a known person; absent for a first sign-in, where the person is
  // created only once the sign-in has actually succeeded.
  userId?: string;
  createdAt: number;
  expiresAt: number;
  state: "open" | "running" | "done" | "failed";
  // Called once with the person's id when the sign-in succeeds. Returns where the page should
  // send the user next (the MCP client's redirect with an authorization code), or nothing.
  onSuccess?: (userId: string) => Promise<string | undefined>;
  redirectUrl?: string;
  failure?: string;
  outcome?: SigninOutcome;
  outcomeDelivered?: boolean;
}

const pending = new Map<string, PendingSignin>();

function sweep(now: number): void {
  for (const [id, p] of pending) {
    // Keep finished entries briefly so the page can read the outcome, then drop them. A running
    // sign-in is never dropped from under its viewer.
    if (p.state !== "running" && p.expiresAt + 60_000 < now) pending.delete(id);
  }
}

export function createSignin(opts: { userId?: string; onSuccess?: PendingSignin["onSuccess"] } = {}, now = Date.now()): PendingSignin {
  sweep(now);
  const signin: PendingSignin = {
    id: randomBytes(24).toString("base64url"),
    userId: opts.userId,
    onSuccess: opts.onSuccess,
    createdAt: now,
    expiresAt: now + config.signinLinkTtlMs,
    state: "open",
  };
  pending.set(signin.id, signin);
  return signin;
}

export function signinUrl(signin: PendingSignin): string {
  return `${config.publicOrigin}/signin/${signin.id}`;
}

// A usable (open, unexpired) sign-in by its link id, or undefined.
export function getOpenSignin(id: string, now = Date.now()): PendingSignin | undefined {
  const p = pending.get(id);
  if (!p || p.state !== "open" || p.expiresAt <= now) return undefined;
  return p;
}

// The sign-in a link may still be used for (open and unexpired, running, or ended with an outcome
// nobody has seen yet), or why it may not.
export function checkSignin(id: string, now = Date.now()): { signin: PendingSignin } | { refused: LinkRefusal } {
  const p = pending.get(id);
  if (!p) return { refused: "unknown" };
  if (p.state === "open") return p.expiresAt <= now ? { refused: "expired" } : { signin: p };
  if (p.state === "running") return { signin: p };
  return p.outcome && !p.outcomeDelivered ? { signin: p } : { refused: "finished" };
}

// The sign-in in any state, for the page to read its outcome.
export function getSignin(id: string): PendingSignin | undefined {
  return pending.get(id);
}

export function resetSigninRegistryForTests(): void {
  pending.clear();
}

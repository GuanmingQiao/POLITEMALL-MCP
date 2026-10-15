import type { CDPSession } from "playwright-core";
import type { D2LSchool } from "../types/schools.js";
import { config } from "../utils/config.js";
import { auditLog } from "../utils/audit-log.js";
import {
  VIEWPORT,
  acquireBrowserSlot,
  harvestSession,
  launchBrowser,
  onD2lHome,
  origins,
  type LaunchedBrowser,
} from "./signin-browser.js";
import type { MintResult } from "./token-mint.js";
import { mintToken } from "./d2l-session.js";
import { createUser, saveBrowserState, saveSchoolSession, type SchoolSession } from "./session-vault.js";
import type { PendingSignin } from "./signin-registry.js";

// One streamed sign-in: a Chromium that exists for exactly this person's sign-in. It is shown to
// them as screencast frames, their pointer and keyboard events are applied to it, and when D2L's
// home is reached the session is harvested, exchanged for a Bearer token, vaulted, and the
// browser is closed. What the person types is forwarded to the page and nowhere else: it is never
// logged, stored or inspected.

const SCHOOLS: D2LSchool[] = ["politemall", "nyp"];
const SECOND_TENANT_GRACE_MS = 60_000;
const POLL_MS = 500;
const MAX_INPUT_PER_SECOND = 400;

export interface SigninIo {
  frame(jpeg: Buffer): void;
  status(message: string): void;
  done(redirect?: string): void;
  fail(reason: string): void;
}

export interface SigninDeps {
  mint: (opts: { school: D2LSchool; cookieHeader: string; xsrfToken: string }) => Promise<MintResult>;
  launch: (storageState?: string) => Promise<LaunchedBrowser>;
}

const defaultDeps: SigninDeps = { mint: (o) => mintToken(o), launch: (s) => launchBrowser(s) };

const KEY_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Delete: 46, Home: 36, End: 35,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, PageUp: 33, PageDown: 34,
};

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

export class SigninSession {
  private launched?: LaunchedBrowser;
  private cdp?: CDPSession;
  private release?: () => void;
  private finished = false;
  private inputWindowStart = 0;
  private inputCount = 0;

  constructor(
    private readonly signin: PendingSignin,
    private readonly io: SigninIo,
    private readonly deps: SigninDeps = defaultDeps,
    private readonly overall = config.signinTimeoutMs
  ) {}

  // Starts the browser and runs until the sign-in succeeds, fails or times out.
  async run(): Promise<void> {
    if (this.signin.state !== "open") return;
    const release = acquireBrowserSlot();
    if (!release) {
      this.signin.state = "failed";
      this.signin.failure = "busy";
      this.io.fail("Other sign-ins are in progress right now. Please try again in a minute.");
      return;
    }
    this.release = release;
    this.signin.state = "running";
    try {
      this.launched = await this.deps.launch();
      const { page, context } = this.launched;
      this.cdp = await context.newCDPSession(page);
      this.cdp.on("Page.screencastFrame", (frame: { data: string; sessionId: number }) => {
        if (!this.finished) this.io.frame(Buffer.from(frame.data, "base64"));
        void this.cdp?.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
      });
      await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });
      this.io.status("Sign in with your Microsoft account.");

      await page.goto(`${origins.politemall}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      const sessions = await this.waitForSessions();
      if (this.finished) return;
      if (sessions.size === 0) throw new Error("The sign-in did not finish in time.");

      const userId = this.signin.userId ?? (await createUser());
      for (const [school, session] of sessions) await saveSchoolSession(userId, school, session);
      await saveBrowserState(userId, JSON.stringify(await context.storageState()));
      const redirect = await this.signin.onSuccess?.(userId);
      this.signin.redirectUrl = redirect;
      this.signin.state = "done";
      auditLog("signin_ok", { schools: [...sessions.keys()] });
      await this.stop();
      this.io.done(redirect);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "The sign-in failed.";
      this.signin.state = "failed";
      this.signin.failure = reason;
      auditLog("signin_failed", {});
      await this.stop();
      this.io.fail(reason);
    }
  }

  // Waits for D2L's home on each school, harvesting and verifying (by minting a token) as each is
  // reached. After the first, the other tenant is opened in the same browser so the Microsoft
  // session signs the person in there without asking again.
  private async waitForSessions(): Promise<Map<D2LSchool, SchoolSession>> {
    const page = this.launched!.page;
    const context = this.launched!.context;
    const found = new Map<D2LSchool, SchoolSession>();
    const deadline = Date.now() + this.overall;
    let secondDeadline = 0;
    let secondStarted = false;

    while (!this.finished && Date.now() < deadline && !page.isClosed()) {
      for (const school of SCHOOLS) {
        if (found.has(school) || !onD2lHome(page.url(), school)) continue;
        const session = await harvestSession(page, context, school);
        if (!session) continue;
        const minted = await this.deps.mint({ school, cookieHeader: session.cookieHeader, xsrfToken: session.xsrfToken });
        if (!minted.ok) continue;
        found.set(school, { ...session, accessToken: minted.accessToken, accessTokenExpiresAt: minted.expiresAt });
        this.io.status(`Signed in to ${school === "nyp" ? "NYP" : "POLITEMall"}.`);
      }
      if (found.size === SCHOOLS.length) break;
      if (found.size === 1 && !secondStarted) {
        secondStarted = true;
        secondDeadline = Date.now() + SECOND_TENANT_GRACE_MS;
        const other = SCHOOLS.find((s) => !found.has(s))!;
        this.io.status(`Connecting ${other === "nyp" ? "NYP" : "POLITEMall"}…`);
        await page.goto(`${origins[other]}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      }
      if (found.size === 1 && Date.now() > secondDeadline) break;
      await page.waitForTimeout(POLL_MS).catch(() => undefined);
    }
    return found;
  }

  // The person asked for a particular tenant's page.
  async openSchool(school: unknown): Promise<void> {
    if (this.finished || !this.launched || (school !== "politemall" && school !== "nyp")) return;
    await this.launched.page.goto(`${origins[school]}/d2l/home`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  }

  // Applies one pointer/keyboard message from the viewer. Malformed or excessive input is ignored.
  async input(msg: unknown): Promise<void> {
    if (this.finished || !this.cdp || typeof msg !== "object" || msg === null) return;
    const now = Date.now();
    if (now - this.inputWindowStart > 1000) {
      this.inputWindowStart = now;
      this.inputCount = 0;
    }
    if (++this.inputCount > MAX_INPUT_PER_SECOND) return;

    const m = msg as Record<string, unknown>;
    const cdp = this.cdp;
    try {
      if (m.t === "mouse") {
        const type = m.type === "down" ? "mousePressed" : m.type === "up" ? "mouseReleased" : m.type === "wheel" ? "mouseWheel" : m.type === "move" ? "mouseMoved" : undefined;
        const x = num(m.x, 0, VIEWPORT.width);
        const y = num(m.y, 0, VIEWPORT.height);
        if (!type || x === undefined || y === undefined) return;
        await cdp.send("Input.dispatchMouseEvent", {
          type, x, y,
          button: m.button === 2 ? "right" : m.button === 1 ? "middle" : type === "mouseMoved" || type === "mouseWheel" ? "none" : "left",
          clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
          deltaX: num(m.dx, -2000, 2000) ?? 0,
          deltaY: num(m.dy, -2000, 2000) ?? 0,
        });
      } else if (m.t === "key" && typeof m.key === "string" && m.key.length <= 20) {
        const printable = m.key.length === 1 && !m.ctrl && !m.meta;
        const code = KEY_CODES[m.key];
        if (!printable && code === undefined) return;
        const modifiers = (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
        await cdp.send("Input.dispatchKeyEvent", {
          type: printable || m.key === "Enter" ? "keyDown" : "rawKeyDown",
          key: m.key,
          text: printable ? m.key : m.key === "Enter" ? "\r" : undefined,
          windowsVirtualKeyCode: code,
          modifiers,
        });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: m.key, windowsVirtualKeyCode: code, modifiers });
      } else if (m.t === "text" && typeof m.text === "string" && m.text.length > 0 && m.text.length <= 512) {
        await cdp.send("Input.insertText", { text: m.text });
      }
    } catch {
      // The page may be navigating; a lost input event is harmless.
    }
  }

  // Ends the browser session and releases its slot. Safe to call more than once.
  async stop(): Promise<void> {
    this.finished = true;
    await this.cdp?.send("Page.stopScreencast").catch(() => undefined);
    await this.launched?.close();
    this.launched = undefined;
    this.release?.();
    this.release = undefined;
    if (this.signin.state === "running") this.signin.state = "failed";
  }
}

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { config } from "../utils/config.js";
import { auditLog } from "../utils/audit-log.js";
import { clientIp } from "./rate-limit.js";
import { userExists, deleteUser } from "./session-vault.js";
import { anonymousLinkCap, createSignin, signinUrl } from "./signin-registry.js";

// The server's own OAuth authorization server, as seen by MCP clients (Claude Code, Claude
// Desktop). Its "log the user in" step is the streamed sign-in page: authorize() sends the person
// there, and when the sign-in succeeds an authorization code bound to that person is issued back
// to the client. PKCE and exact redirect-URI matching are enforced by the SDK's handlers using
// this provider's data. MCP tokens are opaque, random, stored only as hashes, and independent of
// D2L tokens: they identify a person, nothing more.

const ACCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_CLIENTS = 1000;

interface TokenEntry {
  userId: string;
  clientId: string;
  expiresAt: number;
}

interface OAuthFile {
  clients: Record<string, OAuthClientInformationFull>;
  access: Record<string, TokenEntry>;
  refresh: Record<string, TokenEntry>;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function load(): OAuthFile {
  if (!existsSync(config.oauthFile)) return { clients: {}, access: {}, refresh: {} };
  try {
    const f = JSON.parse(readFileSync(config.oauthFile, "utf-8")) as Partial<OAuthFile>;
    return { clients: f.clients ?? {}, access: f.access ?? {}, refresh: f.refresh ?? {} };
  } catch {
    return { clients: {}, access: {}, refresh: {} };
  }
}

function save(file: OAuthFile): void {
  const dir = dirname(config.oauthFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(config.oauthFile, JSON.stringify(file, null, 2), { mode: 0o600 });
}

// Read-modify-write, serialised (the handlers are async).
let chain: Promise<unknown> = Promise.resolve();
function update<T>(fn: (file: OAuthFile) => T): Promise<T> {
  const run = chain.then(() => {
    const file = load();
    const value = fn(file);
    save(file);
    return value;
  });
  chain = run.catch(() => undefined);
  return run;
}

function prune(file: OAuthFile, now: number): void {
  for (const table of [file.access, file.refresh]) {
    for (const [k, v] of Object.entries(table)) if (v.expiresAt <= now) delete table[k];
  }
}

// Authorization codes live only in memory for a few minutes.
interface CodeEntry {
  userId: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  expiresAt: number;
}
const codes = new Map<string, CodeEntry>();

function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

function issueTokens(file: OAuthFile, userId: string, clientId: string, now: number): OAuthTokens {
  prune(file, now);
  const access = randomBytes(32).toString("hex");
  const refresh = randomBytes(32).toString("hex");
  file.access[hash(access)] = { userId, clientId, expiresAt: now + ACCESS_TTL_MS };
  file.refresh[hash(refresh)] = { userId, clientId, expiresAt: now + REFRESH_TTL_MS };
  return { access_token: access, token_type: "bearer", expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh };
}

class ClientsStore implements OAuthRegisteredClientsStore {
  getClient(clientId: string) {
    return load().clients[clientId];
  }
  registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">) {
    return update((file) => {
      const ids = Object.keys(file.clients);
      // Bounded: an endless stream of registrations cannot grow the file forever.
      if (ids.length >= MAX_CLIENTS) delete file.clients[ids[0]];
      const full: OAuthClientInformationFull = { ...client, client_id: randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000) };
      file.clients[full.client_id] = full;
      return full;
    });
  }
}

export class PolitemallOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new ClientsStore();
  // PKCE is checked here, in exchangeAuthorizationCode, so that a code is spent by *any* attempt,
  // including one with the wrong verifier (the SDK's own check would leave the code usable).
  readonly skipLocalPkceValidation = true;

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const ip = clientIp(res.req);
    const capped = anonymousLinkCap(ip);
    if (capped) {
      auditLog("signin_rate_limited", { kind: capped });
      res.status(429).type("text/plain").send("Too many sign-in links are open right now. Please wait a few minutes and try again.");
      return;
    }
    const signin = createSignin({
      ip,
      onSuccess: async (userId) => {
        const code = randomBytes(32).toString("base64url");
        codes.set(code, { userId, clientId: client.client_id, codeChallenge: params.codeChallenge, redirectUri: params.redirectUri, expiresAt: Date.now() + CODE_TTL_MS });
        const target = new URL(params.redirectUri);
        target.searchParams.set("code", code);
        if (params.state) target.searchParams.set("state", params.state);
        return target.toString();
      },
    });
    res.redirect(signinUrl(signin));
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const entry = codes.get(authorizationCode);
    if (!entry || entry.clientId !== client.client_id || entry.expiresAt < Date.now()) throw new InvalidGrantError("Invalid authorization code");
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, codeVerifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const entry = codes.get(authorizationCode);
    // A code works once, whatever happens next.
    codes.delete(authorizationCode);
    if (!entry || entry.clientId !== client.client_id || entry.expiresAt < Date.now()) throw new InvalidGrantError("Invalid authorization code");
    if (!codeVerifier || !pkceMatches(codeVerifier, entry.codeChallenge)) throw new InvalidGrantError("code_verifier does not match the authorization request");
    if (redirectUri && redirectUri !== entry.redirectUri) throw new InvalidGrantError("redirect_uri does not match the authorization request");
    return update((file) => issueTokens(file, entry.userId, client.client_id, Date.now()));
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    return update((file) => {
      const now = Date.now();
      const entry = file.refresh[hash(refreshToken)];
      if (!entry || entry.clientId !== client.client_id || entry.expiresAt <= now || !userExists(entry.userId)) {
        throw new InvalidGrantError("Invalid refresh token");
      }
      // Rotation: the old refresh token is spent.
      delete file.refresh[hash(refreshToken)];
      return issueTokens(file, entry.userId, client.client_id, now);
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const entry = load().access[hash(token)];
    if (!entry || entry.expiresAt <= Date.now() || !userExists(entry.userId)) throw new InvalidTokenError("Invalid or expired token");
    return { token, clientId: entry.clientId, scopes: [], expiresAt: Math.floor(entry.expiresAt / 1000), extra: { userId: entry.userId } };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await update((file) => {
      delete file.access[hash(request.token)];
      delete file.refresh[hash(request.token)];
    });
  }
}

// Sign-out: everything held for the person is deleted, and every MCP token they hold stops working.
export async function signOutUser(userId: string): Promise<void> {
  await update((file) => {
    for (const table of [file.access, file.refresh]) {
      for (const [k, v] of Object.entries(table)) if (v.userId === userId) delete table[k];
    }
  });
  await deleteUser(userId);
}

export function resetOAuthCodesForTests(): void {
  codes.clear();
}

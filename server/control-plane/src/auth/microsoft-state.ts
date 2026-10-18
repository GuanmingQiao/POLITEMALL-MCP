// Reading what Microsoft Entra remembered from a saved browser state (Playwright's storageState
// JSON). Only cookie names, hosts and expiry times are looked at; a cookie value is never read,
// returned or logged. Behaviour follows the public brightspace-mcp-server (MIT); the code is our own.

const ENTRA_HOST = "login.microsoftonline.com";
const ENTRA_COOKIES = new Set(["ESTSAUTH", "ESTSAUTHPERSISTENT", "ESTSAUTHLIGHT"]);

interface StoredCookie {
  name?: unknown;
  domain?: unknown;
  expires?: unknown;
}

export interface BrowserStateLike {
  cookies?: StoredCookie[];
}

export function parseBrowserState(stateJson: string | null | undefined): BrowserStateLike | undefined {
  if (!stateJson) return undefined;
  try {
    const parsed = JSON.parse(stateJson);
    return parsed && typeof parsed === "object" ? (parsed as BrowserStateLike) : undefined;
  } catch {
    return undefined;
  }
}

// Latest expiry (epoch seconds, -1 for a session cookie) of each Entra sign-in cookie in a jar.
function entraExpiries(state: BrowserStateLike | undefined): Map<string, number> {
  const expiries = new Map<string, number>();
  for (const cookie of state?.cookies ?? []) {
    if (typeof cookie.name !== "string" || !ENTRA_COOKIES.has(cookie.name)) continue;
    if (typeof cookie.domain !== "string" || cookie.domain.replace(/^\./, "") !== ENTRA_HOST) continue;
    const expires = typeof cookie.expires === "number" ? cookie.expires : -1;
    expiries.set(cookie.name, Math.max(expires, expiries.get(cookie.name) ?? -Infinity));
  }
  return expiries;
}

// True when `current` holds an Entra sign-in cookie that `previous` lacked, or one that now
// expires later. A jar with no Entra cookies is never newer, so a failed run cannot replace saved
// state with an empty one.
export function hasNewerMicrosoftState(previous: BrowserStateLike | undefined, current: BrowserStateLike | undefined): boolean {
  const before = entraExpiries(previous);
  return [...entraExpiries(current)].some(([name, expires]) => {
    const old = before.get(name);
    return old === undefined || expires > old;
  });
}

// When Microsoft's persistent sign-in cookie expires (epoch seconds), or undefined when the jar
// has none or it is a session cookie (-1), in which case only the flat retention window applies.
export function persistentExpiry(state: BrowserStateLike | undefined): number | undefined {
  const expires = entraExpiries(state).get("ESTSAUTHPERSISTENT");
  return expires !== undefined && expires > 0 ? expires : undefined;
}

// Whether Microsoft issued a persistent sign-in ("Stay signed in?" answered Yes).
export function hasPersistentMicrosoftCookie(state: BrowserStateLike | undefined): boolean {
  return entraExpiries(state).has("ESTSAUTHPERSISTENT");
}

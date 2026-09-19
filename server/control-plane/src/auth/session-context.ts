import type { ToolContext } from "../types/tool-context.js";
import { config } from "../utils/config.js";
import { connectedSchools, getCookieHeader } from "./token-store.js";

// The hosted/local HTTP server's ToolContext: sessions come from the encrypted token store, keyed
// by the caller's bearer token. This is the only place tools' notion of "the caller" touches
// storage.
export function createTokenContext(token: string): ToolContext {
  return {
    connectedSchools: () => connectedSchools(token),
    getCookieHeader: (school) => getCookieHeader(token, school),
    connectUrl: () => `${config.publicOrigin}/connect`,
  };
}

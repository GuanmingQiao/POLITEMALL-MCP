import type { School } from "./schools.js";

// Everything a tool needs to know about "who is calling", and nothing about where that comes
// from. The cloud server builds one per request from the caller's token (auth/session-context.ts);
// any other host (a local run, a test) supplies its own. Tools never import a token store, so the
// exact same tool set runs everywhere.
export interface ToolContext {
  // Schools this caller has a saved session for.
  connectedSchools(): School[];
  // The saved cookie header for a school, or null if that school isn't connected.
  getCookieHeader(school: School): string | null;
  // Where a user goes to (re)connect a school — shown in "session expired" messages.
  connectUrl(): string;
}

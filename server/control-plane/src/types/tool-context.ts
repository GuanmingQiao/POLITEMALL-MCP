import type { School } from "./schools.js";

// Everything a tool needs to know about "who is calling", and nothing about where that comes
// from. The cloud server builds one per request from the caller's signed-in identity
// (auth/session-context.ts); any other host (a test) supplies its own. Tools never import the
// session vault, so the exact same tool set runs everywhere.
export interface ToolContext {
  // Schools this caller has signed in to.
  connectedSchools(): School[];
  // The credential D2L calls carry for a school ("Bearer <token>", renewed as needed), or null if
  // that school isn't connected. Throws SessionExpiredError when the session has ended and could
  // not be renewed silently, and TokenRenewalError when D2L is temporarily unreachable.
  getD2lAuth(school: School): Promise<string | null>;
  // D2L rejected the credential: forget the cached token so the next call renews it.
  invalidateD2lAuth?(school: School): Promise<void>;
  // D2L rejected `rejectedAuth` before it should have expired. A replacement credential to repeat
  // the call with, or null when there is none better. Throws SessionExpiredError when the session
  // is gone and TokenRenewalError when D2L is only temporarily unreachable.
  recoverD2lAuth?(school: School, rejectedAuth: string): Promise<string | null>;
  // Where a user goes to sign in again — shown in "session expired" messages. A fresh one-time
  // link each time it is read.
  connectUrl(): string;
  // A host that signs people in somewhere other than a web link (the local server opens a browser
  // window) supplies this: the sentence that tells the person how to sign in, which also starts the
  // sign-in. When present it replaces "Sign in at <connectUrl()>" in messages.
  connectHint?(): string;
}

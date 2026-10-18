import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { connectedSchools } from "./session-vault.js";
import { getD2lAuth, invalidateD2lAuth, recoverD2lAuth } from "./d2l-session.js";
import { createSignin, signinUrl } from "./signin-registry.js";

// The hosted server's ToolContext: one per request, for the signed-in person the request's MCP
// access token belongs to. This is the only place tools' notion of "the caller" touches storage.
export function createUserContext(userId: string): ToolContext {
  return {
    connectedSchools: () => connectedSchools(userId),
    getD2lAuth: (school) => getD2lAuth(userId, school as D2LSchool),
    invalidateD2lAuth: (school) => invalidateD2lAuth(userId, school as D2LSchool),
    recoverD2lAuth: (school, rejectedAuth) => recoverD2lAuth(userId, school as D2LSchool, rejectedAuth),
    // A fresh one-time link that signs this same person in again.
    connectUrl: () => signinUrl(createSignin({ userId })),
  };
}

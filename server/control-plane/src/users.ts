import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "./config.js";

export interface User {
  id: string;
  name: string;
  token: string;
  tokenCreatedAt: string;
  tokenExpiresAt: string | null;
}

// Re-read on every call instead of caching: the file is tiny (a handful of users),
// and this lets an operator revoke/rotate a token by editing it on the server
// without needing to restart the container.
function readUsers(): User[] {
  const raw = readFileSync(config.usersFile, "utf-8");
  return JSON.parse(raw) as User[];
}

export function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}

export function getUserByToken(token: string): User | undefined {
  const user = readUsers().find((u) => u.token === token);
  if (!user) return undefined;
  if (user.tokenExpiresAt && new Date(user.tokenExpiresAt).getTime() < Date.now()) {
    return undefined;
  }
  return user;
}

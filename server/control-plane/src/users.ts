import { readFileSync } from "node:fs";
import { config } from "./config.js";

export interface User {
  id: string;
  name: string;
  token: string;
}

let usersById: Map<string, User> = new Map();
let usersByToken: Map<string, User> = new Map();

export function loadUsers(): void {
  const raw = readFileSync(config.usersFile, "utf-8");
  const users: User[] = JSON.parse(raw);
  usersById = new Map(users.map((u) => [u.id, u]));
  usersByToken = new Map(users.map((u) => [u.token, u]));
}

export function getUserByToken(token: string): User | undefined {
  return usersByToken.get(token);
}

export function getUserById(id: string): User | undefined {
  return usersById.get(id);
}

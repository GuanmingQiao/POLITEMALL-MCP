import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { routeLogsToStderr } from "./run.js";
import { authCommand, runDoctor, type Check } from "./commands.js";

// `setup`: prerequisites, optional registration with the MCP clients found on this computer, and
// an optional first sign-in. It never asks for a password and never changes a client's
// configuration without a yes.

export const SERVER_NAME = "politemall";
export const SERVER_ENTRY = { command: "npx", args: ["-y", "@qiaoguanming/politemall-mcp@latest"] };

export interface ClientConfig {
  name: string;
  file: string;
}

// MCP clients whose configuration file is already on this computer. Each keeps servers under
// "mcpServers" in a JSON file.
export function detectClients(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): ClientConfig[] {
  const desktopDir =
    platform === "win32" ? join(env.APPDATA || join(home, "AppData", "Roaming"), "Claude") : platform === "darwin" ? join(home, "Library", "Application Support", "Claude") : join(env.XDG_CONFIG_HOME || join(home, ".config"), "Claude");
  const candidates: ClientConfig[] = [
    { name: "Claude Desktop", file: join(desktopDir, "claude_desktop_config.json") },
    { name: "Claude Code (user)", file: join(home, ".claude.json") },
    { name: "Cursor", file: join(home, ".cursor", "mcp.json") },
  ];
  return candidates.filter((c) => existsSync(c.file));
}

export type RegisterResult = "added" | "already" | "unreadable";

// Adds the server to one client's configuration, keeping everything else in the file as it is.
export function registerClient(file: string): RegisterResult {
  let json: Record<string, unknown> = {};
  if (existsSync(file)) {
    const text = readFileSync(file, "utf-8").trim();
    if (text) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "unreadable";
        json = parsed as Record<string, unknown>;
      } catch {
        return "unreadable";
      }
    }
  }
  const servers = (typeof json.mcpServers === "object" && json.mcpServers !== null ? json.mcpServers : {}) as Record<string, unknown>;
  if (SERVER_NAME in servers) return "already";
  json.mcpServers = { ...servers, [SERVER_NAME]: SERVER_ENTRY };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(json, null, 2));
  return "added";
}

export interface SetupIo {
  ask(question: string): Promise<boolean>;
  say(line: string): void;
}

export async function runSetup(io: SetupIo, clients: ClientConfig[], signIn: () => Promise<number>, check: () => Promise<Check[]> = () => runDoctor()): Promise<number> {
  io.say("Checking this computer...");
  const checks = (await check()).filter((c) => c.name === "Node.js" || c.name === "Browser");
  for (const c of checks) io.say(`${c.ok ? "ok  " : "FAIL"}  ${c.name}: ${c.detail}`);
  if (!checks.every((c) => c.ok)) {
    io.say("Fix the items above, then run setup again.");
    return 1;
  }

  if (clients.length === 0) {
    io.say(`No MCP client configuration found. Add this to your client's MCP servers: "${SERVER_NAME}": ${JSON.stringify(SERVER_ENTRY)}`);
  }
  for (const client of clients) {
    if (!(await io.ask(`Add politemall to ${client.name} (${client.file})?`))) continue;
    const result = registerClient(client.file);
    io.say(result === "added" ? `Added to ${client.name}. Restart it to pick this up.` : result === "already" ? `${client.name} already has it.` : `Could not read ${client.file}; left it unchanged.`);
  }

  if (await io.ask("Sign in now? A browser window will open; you type your own Microsoft credentials there.")) return signIn();
  io.say("You can sign in later with `npx -y @qiaoguanming/politemall-mcp@latest auth`, or just ask your assistant something and the window opens.");
  return 0;
}

export async function setupCommand(): Promise<number> {
  routeLogsToStderr();
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const io: SetupIo = {
    say: (line) => console.error(line),
    ask: async (q) => /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim()),
  };
  try {
    return await runSetup(io, detectClients(), authCommand);
  } finally {
    rl.close();
  }
}

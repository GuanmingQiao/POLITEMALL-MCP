import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "../utils/config.js";
import { dataDirProblems } from "../utils/boot-check.js";
import { loadMasterKey } from "../auth/secrets.js";
import { buildMcpServer } from "../server.js";
import { warmD2lVersions } from "../api/d2l-versions.js";
import { SCHOOL_HOSTS } from "../api/d2l-client.js";
import { configureD2lSession } from "../auth/d2l-session.js";
import { silentRelogin } from "../auth/signin-browser.js";
import { startKeepAlive } from "../auth/keep-alive.js";
import { createLocalContext } from "./context.js";
import { KeyMissingError } from "./key-store.js";

// stdout carries the MCP protocol and nothing else, so every log line (the shared modules use
// console.log) goes to stderr instead.
export function routeLogsToStderr(): void {
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = console.log;
}

// Prepares everything a local command needs: a usable data directory and the master key. Throws a
// message-bearing Error when the stored data cannot be used, instead of looking signed out.
export async function prepareLocalStore(): Promise<void> {
  const problems = dataDirProblems([config.sessionFile]);
  if (problems.length > 0) throw new Error(`The data directory is not usable: ${problems.join("; ")}.`);
  await loadMasterKey();
}

// The npx entry point: one MCP server for the one person on this computer, over stdio.
export async function runStdio(): Promise<void> {
  routeLogsToStderr();
  try {
    await prepareLocalStore();
  } catch (err) {
    console.error(err instanceof KeyMissingError || err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  // A lapsed D2L session is renewed from the saved Microsoft sign-in state in a hidden browser.
  configureD2lSession({ silentRelogin });
  // Not awaited: the handshake must not wait on the network. Versions are also discovered lazily.
  void warmD2lVersions(Object.values(SCHOOL_HOSTS)).catch(() => undefined);
  startKeepAlive();

  const server = buildMcpServer(createLocalContext());
  await server.connect(new StdioServerTransport());
  console.error("politemall-mcp running on stdio");
}

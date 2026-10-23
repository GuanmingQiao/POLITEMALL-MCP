import { homedir } from "node:os";
import { join } from "node:path";

// Where a local run keeps its encrypted sessions (and, only when no OS credential store is
// available, its key file): a per-user application-data directory. POLITEMALL_DATA_DIR overrides it.
export function localDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  if (env.POLITEMALL_DATA_DIR) return env.POLITEMALL_DATA_DIR;
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "politemall-mcp");
  if (platform === "darwin") return join(home, "Library", "Application Support", "politemall-mcp");
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "politemall-mcp");
}

import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// The directories that hold SESSION_FILE, OAUTH_FILE and STORE_FILE must be readable and
// writable, and so must any of the files that already exist. Returns a description of every
// problem found.
export function dataDirProblems(files: string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const dir = dirname(file);
    if (!seen.has(dir)) {
      seen.add(dir);
      try {
        // A missing directory is created (first run); one that cannot be created is a problem.
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        accessSync(dir, constants.R_OK | constants.W_OK);
      } catch {
        problems.push(`${dir} is not readable and writable by this user`);
      }
    }
    if (existsSync(file)) {
      try {
        accessSync(file, constants.R_OK | constants.W_OK);
      } catch {
        problems.push(`${file} is not readable and writable by this user`);
      }
    }
  }
  return problems;
}

// Exits non-zero with a clear message when the data directories are unusable.
export function checkDataDirs(files: string[]): void {
  const problems = dataDirProblems(files);
  if (problems.length === 0) return;
  console.error(`Refusing to start: ${problems.join("; ")}. Fix ownership (for example chown -R 1000:1000 server/data) and restart.`);
  process.exit(1);
}

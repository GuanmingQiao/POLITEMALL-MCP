import { createRequire } from "node:module";
import { existsSync, unlinkSync } from "node:fs";
import { chromium } from "playwright-core";
import { config } from "../utils/config.js";
import { dataDirProblems } from "../utils/boot-check.js";
import { SCHOOL_HOSTS } from "../api/d2l-client.js";
import { launchBrowserProcess, NoBrowserError } from "../auth/browser-discovery.js";
import { chromiumArgs } from "../auth/signin-browser.js";
import { connectedSchools } from "../auth/session-vault.js";
import { keyFilePath, loadOsKeyring, removeKey, KEYRING_SERVICE } from "./key-store.js";
import { LOCAL_USER_ID, startLocalSignin } from "./signin.js";
import { prepareLocalStore, routeLogsToStderr } from "./run.js";

export function packageVersion(): string {
  // dist/local/ in the package; one level deeper in the test build.
  for (const path of ["../../package.json", "../../../package.json"]) {
    try {
      return (createRequire(import.meta.url)(path) as { version: string }).version;
    } catch {
      // try the next location
    }
  }
  return "unknown";
}

// Output of these commands is for a person at a terminal, but logs from shared modules must not
// mix into it, so they go to stderr as in the server.
const out = (line = "") => console.error(line);

// `auth`: open the sign-in window and wait for the result.
export async function authCommand(): Promise<number> {
  routeLogsToStderr();
  try {
    await prepareLocalStore();
  } catch (err) {
    out(err instanceof Error ? err.message : String(err));
    return 1;
  }
  out("A sign-in window is opening. Sign in with your Microsoft account there; this window will close by itself.");
  const result = await startLocalSignin();
  if (!result.ok) {
    out(`Sign-in did not complete: ${result.reason}`);
    return 1;
  }
  out(`Signed in to: ${result.schools.join(", ")}.`);
  if (result.notice) out(result.notice);
  return 0;
}

// `auth --logout`: everything stored for this person on this computer is deleted.
export async function logoutCommand(): Promise<number> {
  try {
    if (existsSync(config.sessionFile)) unlinkSync(config.sessionFile);
    removeKey({ dataDir: config.localDir, sessionsFile: config.sessionFile, keyring: await loadOsKeyring(config.localDir) });
  } catch (err) {
    out(`Could not delete the stored data: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  out("Deleted the sign-in data stored on this computer. This does not sign you out of Microsoft or your school's site elsewhere.");
  return 0;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorDeps {
  browser: () => Promise<string>; // resolves with a description, rejects when none works
  reachable: (host: string) => Promise<boolean>;
}

const defaultDeps: DoctorDeps = {
  async browser() {
    const browser = await launchBrowserProcess(chromium.launch.bind(chromium), { headless: true, args: chromiumArgs() }, { local: true });
    const version = browser.version();
    await browser.close();
    return `${process.env.CHROMIUM_PATH ? "CHROMIUM_PATH" : "installed Chrome or Edge"} (Chromium ${version})`;
  },
  async reachable(host) {
    try {
      const res = await fetch(`https://${host}/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
      return res.status > 0;
    } catch {
      return false;
    }
  },
};

// Everything is reported by name only: no key, cookie or token is ever printed.
export async function runDoctor(deps: DoctorDeps = defaultDeps): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node.js", ok: major >= 22, detail: `${process.versions.node} (needs 22 or newer)` });

  try {
    checks.push({ name: "Browser", ok: true, detail: await deps.browser() });
  } catch (err) {
    checks.push({ name: "Browser", ok: false, detail: err instanceof NoBrowserError ? err.message : "a browser was found but could not be started" });
  }

  const problems = dataDirProblems([config.sessionFile]);
  checks.push({ name: "Data directory", ok: problems.length === 0, detail: problems.length === 0 ? config.localDir : problems.join("; ") });

  const ring = await loadOsKeyring(config.localDir);
  let keyDetail = "not created yet (created on first sign-in)";
  let keyOk = true;
  try {
    if (ring?.get()) keyDetail = `OS credential store (${KEYRING_SERVICE})`;
    else if (existsSync(keyFilePath(config.localDir))) keyDetail = `key file in the data directory${ring ? "" : " (no OS credential store available)"}`;
    else if (existsSync(config.sessionFile)) {
      keyOk = false;
      keyDetail = "stored data exists but its key is missing; run `auth --logout` and sign in again";
    }
  } catch {
    keyOk = false;
    keyDetail = "the key store could not be read";
  }
  checks.push({ name: "Encryption key", ok: keyOk, detail: keyDetail });

  for (const [school, host] of Object.entries(SCHOOL_HOSTS)) {
    const up = await deps.reachable(host);
    checks.push({ name: `Reach ${school}`, ok: up, detail: up ? host : `${host} did not answer` });
  }

  const signedIn = existsSync(config.sessionFile) ? connectedSchools(LOCAL_USER_ID) : [];
  checks.push({ name: "Signed in", ok: signedIn.length > 0, detail: signedIn.length > 0 ? signedIn.join(", ") : "no school yet; run `auth`" });
  checks.push({ name: "Version", ok: true, detail: packageVersion() });
  return checks;
}

export async function doctorCommand(): Promise<number> {
  routeLogsToStderr();
  const checks = await runDoctor();
  for (const c of checks) out(`${c.ok ? "ok  " : "FAIL"}  ${c.name}: ${c.detail}`);
  return checks.every((c) => c.ok || c.name === "Signed in") ? 0 : 1;
}

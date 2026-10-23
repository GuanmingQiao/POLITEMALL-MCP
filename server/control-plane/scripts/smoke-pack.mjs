#!/usr/bin/env node
// Packs the package, checks what is inside, installs the tarball into an empty directory and makes
// the installed command answer an MCP handshake over stdio. Run by CI on every pull request and
// again by the publish workflow before anything is uploaded. Needs a prior `npm run build`.
//
//   node scripts/smoke-pack.mjs [--keep]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "politemall-smoke-"));
let failed = false;

const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  failed = true;
};
const ok = (msg) => console.error(`ok    ${msg}`);

// Only the compiled program, the manifest and the usual docs may ship.
export function unexpectedFiles(paths) {
  const allowed = [/^package\.json$/, /^README(\.md)?$/i, /^LICENSE(\.md|\.txt)?$/i, /^CHANGELOG\.md$/i, /^dist\/.+\.(js|json)$/];
  const forbidden = [/\.test\.js$/, /\.map$/, /(^|\/)\.env/, /\.key$/, /sessions\.json$/, /(^|\/)data\//, /(^|\/)node_modules\//];
  return paths.filter((p) => !allowed.some((a) => a.test(p)) || forbidden.some((f) => f.test(p)));
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

async function handshake(entry, dataDir) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, POLITEMALL_KEYRING: "off", POLITEMALL_DATA_DIR: dataDir, HOME: dataDir, USERPROFILE: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
  await new Promise((r) => setTimeout(r, 1500));
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !stdout.includes('"id":2')) await new Promise((r) => setTimeout(r, 200));
  child.kill();
  const lines = stdout.split("\n").filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line));
    } catch {
      fail(`non-JSON-RPC output on stdout: ${line.slice(0, 80)}`);
    }
  }
  if (messages.some((m) => m.jsonrpc !== "2.0")) fail("stdout carried something that is not JSON-RPC 2.0");
  const list = messages.find((m) => m.id === 2);
  const tools = list?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) fail(`tools/list returned no tools. stderr: ${stderr.slice(0, 300)}`);
  else ok(`handshake answered; ${tools.length} tools listed`);
}

try {
  const packOut = run(npm, ["pack", "--json", "--pack-destination", work], root);
  const [packed] = JSON.parse(packOut.slice(packOut.indexOf("[")));
  const paths = packed.files.map((f) => f.path.replace(/\\/g, "/"));
  const extra = unexpectedFiles(paths);
  if (extra.length) fail(`unexpected files in the package: ${extra.join(", ")}`);
  else ok(`package holds ${paths.length} files, all expected`);

  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const bin = Object.values(manifest.bin ?? {})[0];
  if (!bin || !paths.includes(String(bin).replace(/^\.\//, ""))) fail(`bin target ${bin} is not in the package`);

  const installDir = join(work, "install");
  mkdirSync(installDir, { recursive: true });
  run(npm, ["init", "-y"], installDir);
  run(npm, ["install", join(work, packed.filename), "--no-audit", "--no-fund"], installDir);
  const entry = join(installDir, "node_modules", manifest.name, String(bin));
  await handshake(entry, join(work, "data"));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  if (!keep) rmSync(work, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);

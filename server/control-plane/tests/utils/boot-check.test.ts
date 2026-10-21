import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDirProblems } from "../../src/utils/boot-check.js";

// spec: signin-browser-hardening — a data directory the service cannot use stops the start.
test("boot check: passes on a usable directory, creates a missing one, fails loudly on an unusable one", () => {
  const dir = mkdtempSync(join(tmpdir(), "boot-"));
  writeFileSync(join(dir, "sessions.json"), "{}");
  assert.deepEqual(dataDirProblems([join(dir, "sessions.json"), join(dir, "oauth.json"), join(dir, "tokens.json")]), []);

  const fresh = join(dir, "new", "deeper");
  assert.deepEqual(dataDirProblems([join(fresh, "sessions.json")]), []);
  assert.ok(existsSync(fresh));

  // A path whose "directory" is really a file can be neither read as a directory nor created.
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "x");
  const problems = dataDirProblems([join(blocker, "sub", "sessions.json")]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not readable and writable/);
});

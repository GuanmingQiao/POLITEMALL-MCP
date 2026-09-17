import { test } from "node:test";
import assert from "node:assert/strict";
import { checkD2lVersionCompatibility, VersionUnsupportedError, VersionCheckUnreachableError } from "./d2lVersionCheck.js";

// spec: d2l-route-catalog — "a tenant no longer supports the pinned version", "version check
// cannot reach a tenant", "all tenants support the pinned versions"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("checkD2lVersionCompatibility: resolves when every tenant supports the pinned versions", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ Supported: true, LatestVersion: "1.50" }));
  await assert.doesNotReject(() => checkD2lVersionCompatibility());
});

test("checkD2lVersionCompatibility: rejects with VersionUnsupportedError when a reachable tenant reports the pinned version unsupported", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ Supported: false, LatestVersion: "1.50" }));
  await assert.rejects(() => checkD2lVersionCompatibility(), VersionUnsupportedError);
});

test("checkD2lVersionCompatibility: rejects with VersionCheckUnreachableError when a tenant can't be reached", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(() => checkD2lVersionCompatibility(), VersionCheckUnreachableError);
});

test("checkD2lVersionCompatibility: rejects with VersionCheckUnreachableError (not VersionUnsupportedError) on a non-2xx response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ error: "rate limited" }, 429));
  await assert.rejects(() => checkD2lVersionCompatibility(), VersionCheckUnreachableError);
});

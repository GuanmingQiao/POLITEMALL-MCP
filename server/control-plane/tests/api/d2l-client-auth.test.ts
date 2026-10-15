import { test } from "node:test";
import assert from "node:assert/strict";
import { mockD2l, json } from "../helpers/mcp-harness.js";
import { apiGet, apiGetBuffer, authHeaders } from "../../src/api/d2l-client.js";
import { versionedPath } from "../../src/api/d2l-client.js";
import { SessionExpiredError, PermissionDeniedError, NotFoundError } from "../../src/api/errors.js";

// spec: streamed-login-session — D2L calls carry the Bearer token; error mapping is unchanged.

test("a Bearer credential is sent as Authorization, anything else as a Cookie", () => {
  assert.deepEqual(authHeaders("Bearer abc"), { Authorization: "Bearer abc" });
  assert.deepEqual(authHeaders("d2lSessionVal=x"), { Cookie: "d2lSessionVal=x" });
});

test("apiGet and apiGetBuffer send the credential as an Authorization header and no cookie", async (t) => {
  const seen: Record<string, string>[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/d2l/api/versions/")) return json([{ ProductCode: "lp", LatestVersion: "1.63", SupportedVersions: ["1.63"] }, { ProductCode: "le", LatestVersion: "1.97", SupportedVersions: ["1.97"] }]);
    seen.push((init?.headers ?? {}) as Record<string, string>);
    return url.includes("/file") ? new Response(new Uint8Array([1, 2, 3]), { status: 200 }) : json({ ok: true });
  });
  await apiGet("nyp", versionedPath("lp", "/users/whoami"), "Bearer abc");
  await apiGetBuffer("nyp", versionedPath("le", "/1/content/topics/2/file"), "Bearer abc", 100);
  assert.equal(seen.length, 2);
  for (const h of seen) {
    assert.equal(h.Authorization, "Bearer abc");
    assert.equal("Cookie" in h, false);
  }
});

test("401, 403 and 404 map to the same errors as before", async (t) => {
  for (const [status, cls] of [[401, SessionExpiredError], [403, PermissionDeniedError], [404, NotFoundError]] as const) {
    mockD2l(t, () => new Response("", { status }));
    await assert.rejects(apiGet("nyp", versionedPath("lp", "/users/whoami"), "Bearer abc"), cls, String(status));
    t.mock.restoreAll();
  }
});

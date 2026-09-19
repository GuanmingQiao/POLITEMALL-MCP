import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getD2lVersions, compareVersions, pickLatest, resetD2lVersionCache, D2lVersionDiscoveryError } from "../../src/api/d2l-versions.js";
import { callD2lOperation } from "../../src/api/d2l-routes.js";
import { d2lWhoami } from "../../src/api/identity.js";
import { BadRequestError } from "../../src/api/errors.js";
import { getCourseAccess } from "../../src/api/courses.js";

const HOST = "nyplms.polite.edu.sg";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Shaped like GET /d2l/api/versions/ on a real tenant (trimmed to the products we care about).
const VERSIONS_LIST = [
  { ProductCode: "bas", LatestVersion: "1.6", SupportedVersions: ["1.0", "1.6"] },
  { ProductCode: "le", LatestVersion: "1.97", SupportedVersions: ["1.9", "1.10", "1.75", "1.97", "1.96"] },
  { ProductCode: "lp", LatestVersion: "1.63", SupportedVersions: ["1.9", "1.30", "1.63"] },
];

beforeEach(() => {
  resetD2lVersionCache();
  delete process.env.D2L_LE_VERSION;
  delete process.env.D2L_LP_VERSION;
});

test("compareVersions compares numerically, not lexically", () => {
  assert.ok(compareVersions("1.10", "1.9") > 0);
  assert.ok(compareVersions("1.97", "1.100") < 0);
  assert.equal(compareVersions("1.9", "1.9"), 0);
});

test("pickLatest returns the numerically highest supported version even if LatestVersion is stale", () => {
  assert.equal(pickLatest({ ProductCode: "le", LatestVersion: "1.9", SupportedVersions: ["1.9", "1.10", "1.75"] }), "1.75");
});

test("pickLatest rejects a product with no usable versions", () => {
  assert.throws(() => pickLatest({ ProductCode: "le", LatestVersion: "x", SupportedVersions: ["abc"] }), D2lVersionDiscoveryError);
});

test("getD2lVersions discovers the latest le and lp versions from the tenant's versions list", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(String(url));
    return json(VERSIONS_LIST);
  });
  assert.deepEqual(await getD2lVersions(HOST), { le: "1.97", lp: "1.63" });
  assert.deepEqual(calls, [`https://${HOST}/d2l/api/versions/`]);
});

test("getD2lVersions caches per tenant and shares one in-flight request between concurrent callers", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return json(VERSIONS_LIST);
  });
  await Promise.all([getD2lVersions(HOST), getD2lVersions(HOST), getD2lVersions(HOST)]);
  await getD2lVersions(HOST);
  assert.equal(calls, 1);
});

test("getD2lVersions fails clearly when the versions list is unreachable and nothing is cached", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(() => getD2lVersions(HOST), D2lVersionDiscoveryError);
});

test("getD2lVersions fails clearly on a non-2xx answer or a list without the le product", async (t) => {
  t.mock.method(globalThis, "fetch", async () => json({ error: "nope" }, 503));
  await assert.rejects(() => getD2lVersions(HOST), D2lVersionDiscoveryError);
  resetD2lVersionCache();
  t.mock.method(globalThis, "fetch", async () => json([{ ProductCode: "lp", LatestVersion: "1.63", SupportedVersions: ["1.63"] }]));
  await assert.rejects(() => getD2lVersions(HOST), /does not list the "le" API product/);
});

test("D2L_LE_VERSION / D2L_LP_VERSION override discovery", async (t) => {
  process.env.D2L_LE_VERSION = "1.75";
  t.mock.method(globalThis, "fetch", async () => json(VERSIONS_LIST));
  assert.deepEqual(await getD2lVersions(HOST), { le: "1.75", lp: "1.63" });
});

// The bug this whole change exists for: requests must carry the discovered version, and must
// never fall back to a hardcoded one.
test("apiGet requests use the discovered version for le and lp routes", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(String(url));
    if (url.endsWith("/d2l/api/versions/")) return json(VERSIONS_LIST);
    return json({ Objects: [], Next: null });
  });
  await callD2lOperation("nyp", "cookie", "le.grades.finalValuesAll", {}, {}, 524042);
  await d2lWhoami("nyp", "cookie").catch(() => undefined);
  assert.ok(urls.includes(`https://${HOST}/d2l/api/le/1.97/524042/grades/final/values/`), urls.join("\n"));
  assert.ok(urls.includes(`https://${HOST}/d2l/api/lp/1.63/users/whoami`), urls.join("\n"));
  assert.equal(urls.filter((u) => u.endsWith("/d2l/api/versions/")).length, 1, "versions list fetched once, then cached");
});

test("D2L HTTP failures keep their status, route and D2L's own detail", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/d2l/api/versions/")) return json(VERSIONS_LIST);
    return json({ title: "Invalid Parameters", detail: "Request has missing or invalid parameters." }, 400);
  });
  await assert.rejects(
    () => callD2lOperation("nyp", "cookie", "le.grades.finalValuesAll", {}, {}, 524042),
    (err: unknown) =>
      err instanceof BadRequestError &&
      err.status === 400 &&
      err.route === "le/1.97/524042/grades/final/values/" &&
      err.detail === "Request has missing or invalid parameters."
  );
});

test("getCourseAccess reports role for an enrolled course and enrolled:false for a 404", async (t) => {
  let status = 200;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/d2l/api/versions/")) return json(VERSIONS_LIST);
    return status === 200 ? json({ Access: { IsActive: true, ClasslistRoleName: "Tutor" } }) : new Response("", { status });
  });
  assert.deepEqual(await getCourseAccess("nyp", "cookie", 524042), { enrolled: true, role: "Tutor", isActive: true });
  status = 404;
  assert.deepEqual(await getCourseAccess("nyp", "cookie", 1), { enrolled: false, role: null, isActive: null });
});

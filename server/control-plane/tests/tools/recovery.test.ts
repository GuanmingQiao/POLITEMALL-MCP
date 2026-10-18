import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionExpiredError, TokenRenewalError } from "../../src/api/errors.js";
import { runForD2LCourse, runAcrossD2LSchools, authFor } from "../../src/tools/helpers.js";
import type { ToolContext } from "../../src/types/tool-context.js";

// spec: streamed-login-session - "D2L access uses a renewable Bearer token" (rejected-token recovery)

type V = { isError?: boolean; content: { text: string }[] };

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    connectedSchools: () => ["nyp", "politemall"],
    getD2lAuth: async (school) => `Bearer old-${school}`,
    connectUrl: () => "https://server.example/signin/LINK",
    ...over,
  };
}

test("a rejected token is replaced and the call repeated once, and the caller never sees the 401", async () => {
  const used: string[] = [];
  let recoveries = 0;
  const r = await runForD2LCourse(
    ctx({ recoverD2lAuth: async () => (recoveries++, "Bearer new") }),
    "nyp:524042",
    async (_s, auth) => {
      used.push(auth);
      if (auth === "Bearer old-nyp") throw new SessionExpiredError("401");
      return { ok: true };
    }
  );
  assert.deepEqual(used, ["Bearer old-nyp", "Bearer new"]);
  assert.equal(recoveries, 1);
  assert.equal((r as V).isError, undefined);
});

test("recovery is attempted once per call: a second rejection is reported with a sign-in link", async () => {
  let recoveries = 0;
  const invalidated: string[] = [];
  const r = await runForD2LCourse(
    ctx({ recoverD2lAuth: async () => (recoveries++, "Bearer new"), invalidateD2lAuth: async (s) => void invalidated.push(s) }),
    "nyp:524042",
    async () => {
      throw new SessionExpiredError("401");
    }
  );
  assert.equal(recoveries, 1);
  assert.equal((r as V).isError, true);
  assert.match((r as V).content[0].text, /session expired/i);
  assert.match((r as V).content[0].text, /signin\/LINK/);
  assert.deepEqual(invalidated, ["nyp"]);
});

test("a temporary failure while recovering says to try again, with no sign-in link", async () => {
  const r = await runForD2LCourse(
    ctx({
      recoverD2lAuth: async () => {
        throw new TokenRenewalError("Couldn't renew your nyp access right now (HTTP 503).");
      },
    }),
    "nyp:524042",
    async () => {
      throw new SessionExpiredError("401");
    }
  );
  assert.equal((r as V).isError, true);
  assert.match((r as V).content[0].text, /try again shortly/i);
  assert.doesNotMatch((r as V).content[0].text, /signin\/LINK/);
});

test("no better credential (null) or no recover hook behaves exactly as before", async () => {
  for (const hook of [{ recoverD2lAuth: async () => null }, {}]) {
    let calls = 0;
    const r = await runForD2LCourse(ctx(hook), "nyp:524042", async () => {
      calls++;
      throw new SessionExpiredError("401");
    });
    assert.equal(calls, 1, "not repeated");
    assert.equal((r as V).isError, true);
  }
});

test("other errors are never retried", async () => {
  let calls = 0;
  await assert.rejects(
    runForD2LCourse(ctx({ recoverD2lAuth: async () => "Bearer new" }), "nyp:524042", async () => {
      calls++;
      throw new Error("a genuine bug");
    }),
    /genuine bug/
  );
  assert.equal(calls, 1);
});

test("across schools, one school recovering does not disturb the other", async () => {
  const seen: string[] = [];
  const out = await runAcrossD2LSchools(
    ctx({ recoverD2lAuth: async (s) => `Bearer new-${s}` }),
    async (school, auth) => {
      seen.push(`${school}:${auth}`);
      if (school === "nyp" && auth === "Bearer old-nyp") throw new SessionExpiredError("401");
      return [school];
    }
  );
  assert.deepEqual(out.results.sort(), ["nyp", "politemall"]);
  assert.equal(out.failed, 0);
  assert.deepEqual(seen, ["nyp:Bearer old-nyp", "nyp:Bearer new-nyp", "politemall:Bearer old-politemall"]);
});

test("a lapsed school is reported as an expired session with a sign-in link, not as not connected", async () => {
  const lapsed = ctx({
    getD2lAuth: async () => {
      throw new SessionExpiredError("lapsed");
    },
  });
  assert.ok(lapsed.connectedSchools().includes("nyp"), "a lapsed school is still listed");
  const r = await authFor(lapsed, "nyp");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.message, /session expired/i);
    assert.match(r.message, /signin\/LINK/);
    assert.doesNotMatch(r.message, /isn't connected|No school connected/i);
  }
});

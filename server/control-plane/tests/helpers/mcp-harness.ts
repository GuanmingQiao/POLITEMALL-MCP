// Shared harness for tests that drive the real MCP server through a real MCP client, with the real
// (temp-file) token store and encrypted cookie storage. Only D2L's HTTP responses are mocked.
// Import this before any src module: it points the token store at a temp file first.
import { before } from "node:test";
import type { TestContext } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.STORE_FILE = join(tmpdir(), `mcp-test-${randomBytes(4).toString("hex")}.json`);
const { setMasterKey } = await import("../../src/auth/crypto.js");
const { issueToken, saveCookieHeader } = await import("../../src/auth/token-store.js");
const { buildMcpServer } = await import("../../src/server.js");
const { createTokenContext } = await import("../../src/auth/session-context.js");

before(() => setMasterKey(randomBytes(32).toString("base64")));

const VERSIONS = [
  { ProductCode: "le", LatestVersion: "1.97", SupportedVersions: ["1.9", "1.97"] },
  { ProductCode: "lp", LatestVersion: "1.63", SupportedVersions: ["1.9", "1.63"] },
];
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const bare = (status: number) => new Response("", { status });
export const enrollment = (role: string) => json({ Access: { IsActive: true, ClasslistRoleName: role } });

export type Handler = (url: string) => Response | undefined;

// Answers the versions list itself; everything else goes to `handler`, and anything it doesn't
// recognise is a bare 404 (which is what D2L does). Returns the list of URLs requested.
export function mockD2l(t: TestContext, handler: Handler): string[] {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = String(input);
    if (url.endsWith("/d2l/api/versions/")) return json(VERSIONS);
    seen.push(url);
    return handler(url) ?? bare(404);
  });
  return seen;
}

export async function connect(schools: ("nyp" | "politemall")[]) {
  const token = await issueToken();
  for (const s of schools) await saveCookieHeader(token, s, "d2lSessionVal=x");
  const server = buildMcpServer(createTokenContext(token));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return {
    async call(name: string, args: Record<string, unknown> = {}) {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
      return { isError: r.isError === true, text: r.content[0].text };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

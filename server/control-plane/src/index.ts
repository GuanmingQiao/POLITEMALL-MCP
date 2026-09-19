import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./utils/config.js";
import { loadMasterKey } from "./auth/secrets.js";
import { isValidToken, issueToken, saveCookieHeader, tokenLogId } from "./auth/token-store.js";
import { createTokenContext } from "./auth/session-context.js";
import { renderConnectPage } from "./connect-page.js";
import { buildMcpServer } from "./server.js";
import { auditLog } from "./utils/audit-log.js";
import { bearerToken, rateLimitByToken } from "./auth/rate-limit.js";
import { startKeepAlive } from "./auth/keep-alive.js";
import { warmD2lVersions } from "./api/d2l-versions.js";
import { SCHOOL_HOSTS } from "./api/d2l-client.js";
import type { School } from "./types/schools.js";

const VALID_SCHOOLS: School[] = ["politemall", "nyp", "step"];

await loadMasterKey();
// Resolve each D2L tenant's latest LE/LP API version up front so problems show in the boot log.
// Not fatal: versions are discovered lazily too, so a tenant that is briefly unreachable now is
// simply retried on first use.
await warmD2lVersions(Object.values(SCHOOL_HOSTS));

const app = express();
app.set("trust proxy", true);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/connect", (_req, res) => {
  res.send(renderConnectPage());
});

app.use(express.json());

app.post("/signup", rateLimitByToken((req) => req.ip), async (req, res) => {
  const token = await issueToken();
  auditLog("signup", { tokenId: tokenLogId(token), ip: req.ip });
  res.json({ token });
});

app.post("/sync", rateLimitByToken((req) => bearerToken(req)), async (req, res) => {
  const token = bearerToken(req);
  if (!token || !isValidToken(token)) {
    auditLog("sync_rejected", { ip: req.ip });
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { school, cookieHeader } = req.body as { school?: string; cookieHeader?: string };
  if (!school || !VALID_SCHOOLS.includes(school as School)) {
    res.status(400).json({ error: `school must be one of: ${VALID_SCHOOLS.join(", ")}` });
    return;
  }
  if (!cookieHeader || typeof cookieHeader !== "string" || cookieHeader.length < 10) {
    res.status(400).json({ error: "cookieHeader is required" });
    return;
  }

  await saveCookieHeader(token, school as School, cookieHeader);
  auditLog("sync_ok", { tokenId: tokenLogId(token), school, ip: req.ip });
  res.json({ ok: true });
});

app.post("/mcp", rateLimitByToken((req) => bearerToken(req)), async (req, res) => {
  const token = bearerToken(req);
  if (!token || !isValidToken(token)) {
    auditLog("mcp_rejected", { ip: req.ip });
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // JSON-RPC envelope method (e.g. "tools/call") tells you a tool was invoked; params.name is
  // which one — and for the broad-surface call_d2l_operation specifically, its own `operation`
  // argument is the actual D2L route being hit, which is what matters for audit review of a
  // tool that can reach ~155 previously-unreachable routes (see design.md Decision 6).
  const body = req.body as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  const method = body?.method;
  const toolName = method === "tools/call" ? body?.params?.name : undefined;
  const operation = toolName === "call_d2l_operation" ? body?.params?.arguments?.operation : undefined;
  auditLog("mcp_call", { tokenId: tokenLogId(token), method, tool: toolName, operation, ip: req.ip });

  const server = buildMcpServer(createTokenContext(token));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(config.port, () => {
  console.log(`politemall-mcp control-plane listening on :${config.port}`);
});

startKeepAlive();

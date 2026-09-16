import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { loadMasterKey } from "./secrets.js";
import { isValidToken, issueToken, saveCookieHeader, tokenLogId } from "./tokenStore.js";
import { renderConnectPage } from "./connectPage.js";
import { buildMcpServerForToken } from "./mcp.js";
import { auditLog } from "./auditLog.js";
import { bearerToken, rateLimitByToken } from "./rateLimit.js";
import type { School } from "./schools.js";

const VALID_SCHOOLS: School[] = ["politemall", "nyp", "step"];

await loadMasterKey();

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

  const method = (req.body as { method?: string })?.method;
  auditLog("mcp_call", { tokenId: tokenLogId(token), method, ip: req.ip });

  const server = buildMcpServerForToken(token);
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

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { loadMasterKey } from "./secrets.js";
import { getUserByToken, tokenId } from "./users.js";
import { saveUserCookieHeader } from "./store.js";
import { renderConnectPage } from "./connectPage.js";
import { buildMcpServerForUser } from "./mcp.js";
import { auditLog } from "./auditLog.js";
import { bearerToken, rateLimitByToken } from "./rateLimit.js";

await loadMasterKey();

const app = express();
app.set("trust proxy", true);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/connect", (_req, res) => {
  res.send(renderConnectPage());
});

app.use(express.json());

app.post("/sync", rateLimitByToken((req) => bearerToken(req)), async (req, res) => {
  const token = bearerToken(req);
  const user = token ? getUserByToken(token) : undefined;
  if (!user) {
    auditLog("sync_rejected", { ip: req.ip });
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { cookieHeader } = req.body as { cookieHeader?: string };
  if (!cookieHeader || typeof cookieHeader !== "string" || cookieHeader.length < 10) {
    res.status(400).json({ error: "cookieHeader is required" });
    return;
  }

  await saveUserCookieHeader(user.id, cookieHeader);
  auditLog("sync_ok", { userId: user.id, tokenId: tokenId(token!), ip: req.ip });
  res.json({ ok: true });
});

app.post("/mcp", rateLimitByToken((req) => bearerToken(req)), async (req, res) => {
  const token = bearerToken(req);
  const user = token ? getUserByToken(token) : undefined;
  if (!user) {
    auditLog("mcp_rejected", { ip: req.ip });
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const method = (req.body as { method?: string })?.method;
  auditLog("mcp_call", { userId: user.id, tokenId: tokenId(token!), method, ip: req.ip });

  const server = buildMcpServerForUser(user);
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

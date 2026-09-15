import { randomUUID } from "node:crypto";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { loadMasterKey } from "./secrets.js";
import { loadUsers, getUserByToken } from "./users.js";
import { cleanupIfExists, getSession, novncTargetFor, startLoginSession } from "./docker.js";
import { saveUserCookies } from "./store.js";
import { renderLoginPage } from "./loginPage.js";
import { buildMcpServerForUser } from "./mcp.js";

await loadMasterKey();
loadUsers();

const app = express();

const loginStatus = new Map<string, "pending" | "complete">();

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/login", async (req, res) => {
  const token = String(req.query.token ?? "");
  const user = getUserByToken(token);
  if (!user) return res.status(401).send("Invalid or unknown login token.");

  const sessionId = randomUUID();
  loginStatus.set(sessionId, "pending");
  await startLoginSession(sessionId, user.id);

  res.send(renderLoginPage(sessionId, user.name));
});

app.get("/login/status", (req, res) => {
  const sessionId = String(req.query.sessionId ?? "");
  res.json({ status: loginStatus.get(sessionId) ?? "unknown" });
});

app.use(express.json());

app.post("/internal/login-complete", async (req, res) => {
  const { sessionId, cookies } = req.body as { sessionId: string; cookies: unknown[] };
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: "unknown session" });
  if (req.header("X-Callback-Secret") !== session.callbackSecret) {
    return res.status(403).json({ error: "bad callback secret" });
  }

  await saveUserCookies(session.userId, cookies as any);
  loginStatus.set(sessionId, "complete");
  res.json({ ok: true });

  setTimeout(() => void cleanupIfExists(sessionId), 3000);
});

app.post("/mcp", async (req, res) => {
  const auth = req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const server = buildMcpServerForUser(user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Reverse proxy to the ephemeral per-session noVNC container (HTTP + WebSocket).
// Mounted at the root (not via an Express path pattern) so req.url is always the
// full original path for both regular HTTP requests and WebSocket upgrades — Express
// strips a matched app.use() path prefix from req.url, but upgrade events bypass
// Express entirely and always see the untouched original URL.
const vncProxy = createProxyMiddleware({
  target: "http://placeholder",
  ws: true,
  changeOrigin: true,
  pathFilter: "/vnc/**",
  router: (req) => {
    const sessionId = req.url?.split("/")[2] ?? "";
    return novncTargetFor(sessionId) ?? "http://127.0.0.1:1";
  },
  pathRewrite: (path) => path.replace(/^\/vnc\/[^/]+/, ""),
});
app.use(vncProxy);

const server = app.listen(config.port, () => {
  console.log(`politemall-mcp control-plane listening on :${config.port}`);
});
server.on("upgrade", vncProxy.upgrade as any);

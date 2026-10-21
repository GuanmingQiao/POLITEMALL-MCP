import express from "express";
import { createHash } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { config } from "./utils/config.js";
import { buildMcpServer } from "./server.js";
import { auditLog } from "./utils/audit-log.js";
import { clientIp, rateLimitByToken } from "./auth/rate-limit.js";
import { createUserContext } from "./auth/session-context.js";
import { PolitemallOAuthProvider, signOutUser } from "./auth/oauth-provider.js";
import { signinPage } from "./auth/signin-stream.js";

// A short, one-way identifier safe to put in logs: never a token, never reversible to a person.
export function userLogId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 8);
}

// The whole HTTP surface, without listening: MCP over OAuth, the streamed sign-in page, sign-out
// and the health check. Cookie upload and token signup endpoints no longer exist.
export function buildApp(provider = new PolitemallOAuthProvider()): express.Express {
  const app = express();
  // Exactly one trusted hop (Caddy), so a client cannot spoof its address to dodge the IP rate limits.
  app.set("trust proxy", 1);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  const origin = config.publicOrigin || `http://localhost:${config.port}`;
  const resourceServerUrl = new URL(`${origin}/mcp`);
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(origin),
      resourceServerUrl,
      resourceName: "POLITEMall MCP",
    })
  );

  app.get("/signin/:id", rateLimitByToken((req) => `ip:${clientIp(req)}`), signinPage);

  const requireUser = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl) });
  const perUserLimit = rateLimitByToken((req) => (req.auth?.extra?.userId as string | undefined));

  // Deletes everything held for the caller and revokes all their MCP tokens.
  app.post("/signout", requireUser, async (req, res) => {
    const userId = req.auth!.extra!.userId as string;
    await signOutUser(userId);
    auditLog("signout", { userId: userLogId(userId), ip: req.ip });
    res.json({ ok: true });
  });

  app.post("/mcp", requireUser, perUserLimit, express.json(), async (req, res) => {
    const userId = req.auth!.extra!.userId as string;

    // JSON-RPC envelope method (e.g. "tools/call") tells you a tool was invoked; params.name is
    // which one — and for the broad-surface call_d2l_operation specifically, its own `operation`
    // argument is the actual D2L route being hit, which is what matters for audit review of a
    // tool that can reach ~155 previously-unreachable routes (see the d2l-route-catalog design).
    const body = req.body as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    const method = body?.method;
    const toolName = method === "tools/call" ? body?.params?.name : undefined;
    const operation = toolName === "call_d2l_operation" ? body?.params?.arguments?.operation : undefined;
    auditLog("mcp_call", { userId: userLogId(userId), method, tool: toolName, operation, ip: req.ip });

    const server = buildMcpServer(createUserContext(userId));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}

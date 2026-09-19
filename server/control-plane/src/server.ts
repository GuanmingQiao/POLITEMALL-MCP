import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./types/tool-context.js";
import { registerAllTools } from "./tools/index.js";

// Builds the MCP server for one caller. Hosting (HTTP, auth, rate limiting) lives in index.ts;
// which sessions the caller has lives in the ToolContext. Nothing here differs between a cloud
// and a local run.
export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "politemall-mcp", version: "0.1.0" });
  registerAllTools(server, ctx);
  return server;
}

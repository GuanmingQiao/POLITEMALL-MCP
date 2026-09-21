import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./types/tool-context.js";
import { registerAllTools } from "./tools/index.js";
import { CITATION_INSTRUCTIONS } from "./tools/provenance.js";
import { sourceLinksEnabled } from "./utils/config.js";

// Builds the MCP server for one caller. Hosting (HTTP, auth, rate limiting) lives in index.ts;
// which sessions the caller has lives in the ToolContext. Nothing here differs between a cloud
// and a local run.
export function buildMcpServer(ctx: ToolContext): McpServer {
  // The citation rules are part of the evidence-links feature, so SOURCE_LINKS=off removes them too.
  const server = new McpServer(
    { name: "politemall-mcp", version: "0.1.0" },
    sourceLinksEnabled() ? { instructions: CITATION_INSTRUCTIONS } : undefined
  );
  registerAllTools(server, ctx);
  return server;
}

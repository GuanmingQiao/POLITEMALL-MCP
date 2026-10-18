import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { d2lWhoami } from "../api/identity.js";
import { READ_ONLY } from "./schemas.js";
import type { Source } from "./provenance.js";
import { toolResult, explainD2lError, authFor, withRecovery } from "./helpers.js";

const D2L_SCHOOLS: D2LSchool[] = ["politemall", "nyp"];

export function registerWhoami(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "whoami",
    {
      title: "Whoami",
      description: "Get your identity on each connected school (POLITEMall and/or NYP).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const results: Record<string, unknown> = {};
      const warnings: string[] = [];
      const sources: Source[] = [];

      for (const school of D2L_SCHOOLS) {
        if (!ctx.connectedSchools().includes(school)) continue;
        const credential = await authFor(ctx, school);
        if (!credential.ok) {
          warnings.push(`${school}: ${credential.message}`);
          continue;
        }
        const holder = { auth: credential.auth };
        try {
          results[school] = await withRecovery(ctx, school, holder, (auth) => d2lWhoami(school, auth));
          sources.push(school);
        } catch (err) {
          const message = await explainD2lError(ctx, err, school, holder.auth);
          if (message === undefined) throw err;
          warnings.push(`${school}: ${message}`);
        }
      }

      return toolResult({ ...results, warnings: warnings.length ? warnings : undefined }, sources);
    }
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { d2lWhoami } from "../api/identity.js";
import * as step from "../api/step-client.js";
import { SessionExpiredError as StepSessionExpiredError } from "../api/step-client.js";
import { READ_ONLY } from "./schemas.js";
import { stepLink } from "../utils/deep-links.js";
import type { Source } from "./provenance.js";
import { toolResult, explainD2lError } from "./helpers.js";

const D2L_SCHOOLS: D2LSchool[] = ["politemall", "nyp"];

export function registerWhoami(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "whoami",
    {
      title: "Whoami",
      description: "Get your identity on each connected school (POLITEMall, NYP, and/or STEP).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const results: Record<string, unknown> = {};
      const warnings: string[] = [];
      const sources: Source[] = [];

      for (const school of D2L_SCHOOLS) {
        const cookieHeader = ctx.getCookieHeader(school);
        if (!cookieHeader) continue;
        try {
          results[school] = await d2lWhoami(school, cookieHeader);
          sources.push(school);
        } catch (err) {
          const message = await explainD2lError(ctx, err, school, cookieHeader);
          if (message === undefined) throw err;
          warnings.push(`${school}: ${message}`);
        }
      }

      const stepCookie = ctx.getCookieHeader("step");
      if (stepCookie) {
        try {
          results.step = await step.whoami(stepCookie);
          sources.push("step");
        } catch (err) {
          if (err instanceof StepSessionExpiredError) {
            warnings.push(`Your STEP session expired — reconnect it at ${ctx.connectUrl()}.`);
          } else {
            throw err;
          }
        }
      }

      // Brightspace identity has no page of its own; the STEP profile does.
      const profile = sources.includes("step") ? stepLink.profile() : undefined;
      return toolResult({ ...results, warnings: warnings.length ? warnings : undefined }, sources, profile ? { pageUrls: { step: profile } } : {});
    }
  );
}

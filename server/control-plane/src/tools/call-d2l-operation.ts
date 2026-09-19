import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { getRouteDescriptor } from "../api/route-catalog.js";
import { callD2lOperation } from "../api/d2l-routes.js";
import { parseCourseId } from "../api/courses.js";
import { InvalidRouteParamsError, UnsupportedOperationError } from "../api/errors.js";
import { READ_ONLY } from "./schemas.js";
import { toolResult, errorResult, explainD2lError } from "./helpers.js";

export function registerCallD2lOperation(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "call_d2l_operation",
    {
      title: "Call D2L operation (advanced)",
      description:
        "Invoke any cataloged D2L Valence route by its operation key — the long-tail escape hatch for routes without a dedicated tool above. Use list_d2l_operations first to find the right operation key and its parameters. Course-scoped operations need courseId (orgUnitId is derived from it automatically — never pass orgUnitId directly); global/user-scoped operations need school instead. Always read-only (GET); operations that return binary file content are rejected, not supported here.",
      inputSchema: {
        operation: z.string().describe('The catalog operation key, from list_d2l_operations, e.g. "le.checklists.list"'),
        courseId: z.string().optional().describe("Required for course-scoped operations — the course's courseId from list_courses"),
        school: z.enum(["politemall", "nyp"]).optional().describe("Required for global/user-scoped operations that aren't tied to one course"),
        pathParams: z.record(z.unknown()).optional().describe("Path parameters the operation needs, other than orgUnitId"),
        queryParams: z.record(z.unknown()).optional().describe("Query parameters the operation accepts"),
      },
      annotations: READ_ONLY,
    },
    async ({ operation, courseId, school, pathParams, queryParams }) => {
      const descriptor = getRouteDescriptor(operation);
      if (!descriptor) {
        return errorResult(`Unknown D2L operation "${operation}". Use list_d2l_operations to find a valid one.`);
      }

      let targetSchool: D2LSchool;
      let orgUnitId: number | undefined;
      if (descriptor.scope === "course") {
        if (!courseId) return errorResult(`Operation "${operation}" is course-scoped — pass courseId.`);
        const parsed = parseCourseId(courseId);
        targetSchool = parsed.school;
        orgUnitId = parsed.numericId;
      } else {
        if (!school) {
          return errorResult(`Operation "${operation}" is not course-scoped — pass school ("politemall" or "nyp") instead of courseId.`);
        }
        targetSchool = school;
      }

      const cookieHeader = ctx.getCookieHeader(targetSchool);
      if (!cookieHeader) {
        return errorResult(`Your ${targetSchool} session isn't connected. Connect it at ${ctx.connectUrl()}.`);
      }

      try {
        const result = await callD2lOperation(targetSchool, cookieHeader, operation, pathParams ?? {}, queryParams ?? {}, orgUnitId);
        return toolResult({ operation, result });
      } catch (err) {
        if (err instanceof InvalidRouteParamsError || err instanceof UnsupportedOperationError) {
          return errorResult(err.message);
        }
        const message = await explainD2lError(ctx, err, targetSchool, cookieHeader, courseId);
        if (message === undefined) throw err;
        return errorResult(`"${operation}" failed. ${message}`);
      }
    }
  );
}

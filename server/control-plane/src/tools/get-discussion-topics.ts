import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { link } from "../utils/deep-links.js";
import { addSgt, linked, withSourceUrl } from "./provenance.js";
import { runForD2LCourse } from "./helpers.js";

export function registerGetDiscussionTopics(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_discussion_topics",
    {
      title: "Get discussion topics",
      description: "List topics within a discussion forum.",
      inputSchema: {
        courseId: courseIdField,
        forumId: z.number().describe("The forum's ForumId, from get_discussion_forums"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, forumId }) =>
      runForD2LCourse(ctx, courseId, async (school, cookie, id) => {
        const topics = await apiGet<Record<string, unknown>[]>(school, resolveD2lPath("le.discussions.topicsList", { forumId }, id), cookie);
        return linked(
          topics.map((t) => withSourceUrl(addSgt(t, ["StartDate", "EndDate", "UnlockStartDate", "LockEndDate"]), link.discussionTopic(school, id, t.TopicId))),
          { pageUrl: link.discussionsList(school, id) }
        );
      })
  );
}

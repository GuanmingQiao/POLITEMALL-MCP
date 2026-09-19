// Draft filtering, effective-date sorting, count limit and the all-courses mode adapted from
// brightspace-mcp-server's get_announcements (MIT, (c) 2026 Rohan Muppa — see
// THIRD_PARTY_NOTICES.md). Differences on purpose: it spans every connected school, reports
// courses it could not read instead of hiding them, and returns plain-text bodies (rich HTML
// only when D2L sent no text).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import type { RichText } from "../types/d2l.js";
import { apiGet } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { listCourses } from "../api/courses.js";
import { D2lHttpError } from "../api/errors.js";
import { htmlToMarkdown } from "../utils/html-to-markdown.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { READ_ONLY } from "./schemas.js";
import { toolResult, errorResult, runForD2LCourse, runAcrossD2LSchools } from "./helpers.js";

export interface NewsItem {
  Id: number;
  Title: string;
  Body: RichText | null;
  CreatedBy: { Identifier?: string; DisplayName?: string } | null;
  CreatedDate: string | null;
  StartDate: string | null;
  IsPublished?: boolean;
  IsPinned?: boolean;
  IsHidden?: boolean;
  Attachments?: unknown[];
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  createdBy: string | null;
  date: string | null;
  isPinned: boolean;
  isHidden?: true;
  hasAttachments?: true;
  // Set in the all-courses view.
  courseId?: string;
  courseName?: string;
}

// A date the runtime can order, or null — unreadable and absent are the same answer.
function readableDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return Number.isNaN(new Date(raw).getTime()) ? null : raw;
}

// StartDate is when the instructor scheduled the post, the honest date whenever there is one;
// CreatedDate is the fallback for a post nobody scheduled.
export function effectiveDate(item: NewsItem): string | null {
  return readableDate(item.StartDate) ?? readableDate(item.CreatedDate);
}

// False only for an explicit draft. A missing field is a shape we've never seen, and treating
// "unknown" as "unpublished" would empty the list the day D2L renames the field.
export function isPublishedNewsItem(item: NewsItem): boolean {
  return item.IsPublished !== false;
}

// Newest first by the scheduled date; undated last. Equal dates keep the server's order.
export function newestFirst(a: { date: string | null }, b: { date: string | null }): number {
  if (a.date === b.date) return 0;
  if (a.date === null) return 1;
  if (b.date === null) return -1;
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}

export function mapNewsItem(item: NewsItem): Announcement {
  const text = item.Body?.Text?.trim();
  return {
    id: item.Id,
    title: item.Title,
    body: text ? text : htmlToMarkdown(item.Body?.Html),
    // D2L sometimes sends an empty object here (seen on NYP), so an absent name is null.
    createdBy: item.CreatedBy?.DisplayName ?? null,
    date: effectiveDate(item),
    isPinned: item.IsPinned ?? false,
    ...(item.IsHidden ? { isHidden: true as const } : {}),
    ...(item.Attachments?.length ? { hasAttachments: true as const } : {}),
  };
}

async function fetchCourseNews(school: D2LSchool, cookieHeader: string, numericId: number): Promise<Announcement[]> {
  const items = await apiGet<NewsItem[]>(school, resolveD2lPath("le.news.list", {}, numericId), cookieHeader);
  return items.filter(isPublishedNewsItem).map(mapNewsItem);
}

export function registerGetAnnouncements(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_announcements",
    {
      title: "Get announcements",
      description:
        "Fetch recent announcements, newest first, with plain-text bodies. Pass courseId for one course, or omit it to get the latest across all your active courses on every connected school (each item then carries courseId and courseName). Drafts are excluded. Use this when the user asks about announcements, news, updates from instructors, recent posts, or what a lecturer said. The response says how many exist in total, so you can tell when count cut the list short.",
      inputSchema: {
        courseId: z.string().optional().describe("The course's courseId, from list_courses. If omitted, returns recent announcements across all active courses."),
        count: z.number().int().min(1).max(50).optional().describe("Maximum number of announcements to return (default 10, max 50)"),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, count }) => {
      const limit = count ?? 10;

      if (courseId) {
        return runForD2LCourse(ctx, courseId, async (school, cookie, id) => {
          const all = (await fetchCourseNews(school, cookie, id)).sort(newestFirst);
          return { courseId, total: all.length, returned: Math.min(limit, all.length), announcements: all.slice(0, limit) };
        });
      }

      const skippedCourses: string[] = [];
      const { results, warnings, attempted, failed } = await runAcrossD2LSchools(ctx, async (school, cookie) => {
        const courses = (await listCourses(school, cookie)).filter((c) => c.isActive);
        const perCourse = await mapWithConcurrency(courses, 5, async (course) => {
          try {
            const numericId = Number(course.courseId.split(":")[1]);
            return (await fetchCourseNews(school, cookie, numericId)).map((a) => ({ ...a, courseId: course.courseId, courseName: course.name }));
          } catch (err) {
            // A course whose news we can't read (past course, tool off, no access) shouldn't hide
            // the rest — but say which one was skipped. Session/version problems still fail the school.
            if (err instanceof D2lHttpError) {
              skippedCourses.push(`${course.courseId} (${course.name}): D2L answered ${err.status}`);
              return [];
            }
            throw err;
          }
        });
        return perCourse.flat();
      });

      if (attempted > 0 && failed === attempted) return errorResult(warnings.join("\n"));
      const all = results.sort(newestFirst);
      return toolResult({
        total: all.length,
        returned: Math.min(limit, all.length),
        announcements: all.slice(0, limit),
        ...(skippedCourses.length ? { skippedCourses } : {}),
        ...(warnings.length ? { warnings } : {}),
      });
    }
  );
}

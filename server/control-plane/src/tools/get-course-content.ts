// Output shape, type/module/depth filters and Markdown conversion adapted from
// brightspace-mcp-server's get_course_content (MIT, (c) 2026 Rohan Muppa — see
// THIRD_PARTY_NOTICES.md). Differences on purpose:
//  - one request: D2L's /content/toc returns the whole tree, where the original walks
//    /content/root/ and then makes one /structure/ request per module;
//  - completion is only reported when D2L actually returns progress data, instead of
//    defaulting every topic to "not completed".
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import type { RichText } from "../types/d2l.js";
import { apiGet, versionedPath, SCHOOL_HOSTS } from "../api/d2l-client.js";
import { resolveD2lPath } from "../api/d2l-routes.js";
import { D2lHttpError } from "../api/errors.js";
import { htmlToMarkdown } from "../utils/html-to-markdown.js";
import { READ_ONLY, courseIdField } from "./schemas.js";
import { runForD2LCourse } from "./helpers.js";

interface TocTopic {
  TopicId: number;
  Title: string;
  TypeIdentifier?: string | null;
  Url?: string | null;
  Description?: RichText | null;
  IsHidden?: boolean;
  IsLocked?: boolean;
  StartDateTime?: string | null;
  EndDateTime?: string | null;
  SortOrder?: number;
}
interface TocModule {
  ModuleId: number;
  Title: string;
  Description?: RichText | null;
  IsHidden?: boolean;
  IsLocked?: boolean;
  StartDateTime?: string | null;
  EndDateTime?: string | null;
  SortOrder?: number;
  Modules?: TocModule[];
  Topics?: TocTopic[];
}
interface Toc {
  Modules: TocModule[];
}

export type TypeFilter = "file" | "link" | "html" | "video" | "all";
export interface ContentOptions {
  typeFilter: TypeFilter;
  moduleTitle?: string;
  maxDepth?: number;
}
export interface Progress {
  isRead: boolean;
  dateCompleted: string | null;
}

export type ContentNode = ModuleNode | TopicNode;
export interface ModuleNode {
  type: "module";
  id: number;
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  isHidden: boolean;
  isLocked: boolean;
  children: ContentNode[];
  // Set when maxDepth stopped the descent: how many direct children were left out.
  childrenOmitted?: number;
}
export interface TopicNode {
  type: "topic";
  topicType: "file" | "link" | "other";
  // The raw D2L type name, only when topicType is "other" (e.g. "ContentService").
  typeIdentifier?: string;
  id: number;
  title: string;
  isHidden: boolean;
  isLocked: boolean;
  url?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  isCompleted?: boolean;
  completedDate?: string | null;
}

export function topicKind(t: TocTopic): TopicNode["topicType"] {
  const id = (t.TypeIdentifier ?? "").toLowerCase();
  if (id === "file") return "file";
  if (id === "link") return "link";
  return "other";
}

const VIDEO_URL = /youtube|vimeo|kaltura|video/i;

export function matchesTypeFilter(t: TocTopic, filter: TypeFilter): boolean {
  const kind = topicKind(t);
  switch (filter) {
    case "file":
      return kind === "file";
    case "link":
      return kind === "link";
    case "html":
      return !!t.Description?.Html && kind !== "file";
    case "video":
      return kind === "link" && VIDEO_URL.test(t.Url ?? "");
    default:
      return true;
  }
}

// Markdown from the rich-text HTML when there is any, else the plain text, else nothing.
function describe(d: RichText | null | undefined): string | undefined {
  const md = htmlToMarkdown(d?.Html);
  if (md) return md;
  const text = d?.Text?.trim();
  return text ? text : undefined;
}

// A module's children in the order D2L shows them: sub-modules and topics share one SortOrder.
function orderedChildren(m: TocModule): ({ kind: "module"; v: TocModule } | { kind: "topic"; v: TocTopic })[] {
  const all = [
    ...(m.Modules ?? []).map((v) => ({ kind: "module" as const, v })),
    ...(m.Topics ?? []).map((v) => ({ kind: "topic" as const, v })),
  ];
  return all.sort((a, b) => (a.v.SortOrder ?? 0) - (b.v.SortOrder ?? 0));
}

export function buildTree(modules: TocModule[], opts: ContentOptions, progress: Map<number, Progress> | null, depth = 0): ContentNode[] {
  const tree: ContentNode[] = [];
  const canDescend = opts.maxDepth === undefined || depth < opts.maxDepth;

  for (const m of modules) {
    const children = orderedChildren(m);
    let built: ContentNode[] = [];
    if (canDescend) {
      for (const c of children) {
        if (c.kind === "module") {
          built.push(...buildTree([c.v], opts, progress, depth + 1));
        } else {
          if (opts.typeFilter !== "all" && !matchesTypeFilter(c.v, opts.typeFilter)) continue;
          built.push(topicNode(c.v, progress));
        }
      }
    }

    // Under a type filter a module is only worth showing if something inside matched.
    if (opts.typeFilter !== "all" && built.length === 0) continue;

    const node: ModuleNode = {
      type: "module",
      id: m.ModuleId,
      title: m.Title,
      ...(describe(m.Description) ? { description: describe(m.Description) } : {}),
      ...(m.StartDateTime ? { startDate: m.StartDateTime } : {}),
      ...(m.EndDateTime ? { endDate: m.EndDateTime } : {}),
      isHidden: m.IsHidden ?? false,
      isLocked: m.IsLocked ?? false,
      children: built,
    };
    if (!canDescend && children.length > 0) node.childrenOmitted = children.length;
    tree.push(node);
  }
  return tree;
}

function topicNode(t: TocTopic, progress: Map<number, Progress> | null): TopicNode {
  const kind = topicKind(t);
  const description = describe(t.Description);
  const p = progress?.get(t.TopicId);
  return {
    type: "topic",
    topicType: kind,
    ...(kind === "other" && t.TypeIdentifier ? { typeIdentifier: t.TypeIdentifier } : {}),
    id: t.TopicId,
    title: t.Title,
    isHidden: t.IsHidden ?? false,
    isLocked: t.IsLocked ?? false,
    ...(t.Url ? { url: t.Url } : {}),
    ...(description ? { description } : {}),
    ...(t.StartDateTime ? { startDate: t.StartDateTime } : {}),
    ...(t.EndDateTime ? { endDate: t.EndDateTime } : {}),
    // Only when D2L returned progress data: absent data must not read as "not completed".
    ...(progress ? { isCompleted: p?.isRead ?? false, completedDate: p?.dateCompleted ?? null } : {}),
  };
}

export function countTopics(tree: ContentNode[]): number {
  return tree.reduce((n, x) => n + (x.type === "topic" ? 1 : countTopics(x.children)), 0);
}
export function countModules(tree: ContentNode[]): number {
  return tree.reduce((n, x) => n + (x.type === "module" ? 1 + countModules(x.children) : 0), 0);
}

// The user's own completion state. Many tenants (NYP among them) answer 404/403 because the
// course doesn't track it; that is "no progress data", not an error.
async function fetchProgress(school: D2LSchool, cookieHeader: string, numericId: number): Promise<Map<number, Progress> | null> {
  const map = new Map<number, Progress>();
  try {
    let next: string | null = versionedPath("le", `/${numericId}/content/userprogress/`);
    for (let page = 0; page < 20 && next; page++) {
      const raw: unknown = await apiGet(school, next, cookieHeader);
      const isArray = Array.isArray(raw);
      const items = (isArray ? raw : (raw as { Objects?: unknown[] })?.Objects ?? []) as {
        ContentObjectId: number;
        IsRead: boolean;
        DateCompleted: string | null;
      }[];
      for (const p of items) map.set(p.ContentObjectId, { isRead: p.IsRead, dateCompleted: p.DateCompleted ?? null });
      const link = isArray ? null : (raw as { Next?: string | null })?.Next;
      next = link ? link.replace(`https://${SCHOOL_HOSTS[school]}`, "") : null;
    }
    return map;
  } catch (err) {
    if (err instanceof D2lHttpError) return null;
    throw err;
  }
}

export async function getCourseContent(school: D2LSchool, cookieHeader: string, numericId: number, opts: ContentOptions) {
  const [toc, progress] = await Promise.all([
    apiGet<Toc>(school, resolveD2lPath("le.content.toc", {}, numericId), cookieHeader),
    fetchProgress(school, cookieHeader, numericId),
  ]);

  let roots = toc.Modules ?? [];
  if (opts.moduleTitle) {
    const needle = opts.moduleTitle.toLowerCase();
    roots = roots.filter((m) => m.Title.toLowerCase().includes(needle));
  }

  const contentTree = buildTree(roots, opts, progress);
  return {
    typeFilter: opts.typeFilter,
    ...(opts.moduleTitle ? { moduleTitle: opts.moduleTitle } : {}),
    ...(opts.maxDepth ? { maxDepth: opts.maxDepth } : {}),
    progressAvailable: progress !== null,
    moduleCount: countModules(contentTree),
    topicCount: countTopics(contentTree),
    contentTree,
  };
}

export function registerGetCourseContent(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_course_content",
    {
      title: "Get course content",
      description:
        "Fetch the content tree for a course showing modules, topics, files, and links. Use this when the user asks about course materials, lecture slides, uploaded files, content structure, or what's in a course module. Use moduleTitle to filter to a specific module (e.g. 'Labs', 'Week 3') instead of fetching the entire tree, typeFilter to keep only files, links, HTML pages or videos, and maxDepth (1 = top-level modules with their direct children) for a table-of-contents view. Topic ids can be passed to get_content_topic. Completion (isCompleted) appears only when the course tracks it (progressAvailable).",
      inputSchema: {
        courseId: courseIdField,
        typeFilter: z.enum(["file", "link", "html", "video", "all"]).optional().describe("Optional filter to narrow results by content type. Default all."),
        moduleTitle: z
          .string()
          .optional()
          .describe("Case-insensitive substring match on top-level module titles (e.g. 'Labs', 'Week 3'). Children of matching modules are included in full."),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Limit how deep the tree goes. 1 returns top-level modules with their direct children only; deeper modules then report childrenOmitted."),
      },
      annotations: READ_ONLY,
    },
    async ({ courseId, typeFilter, moduleTitle, maxDepth }) =>
      runForD2LCourse(ctx, courseId, async (school, cookie, id) => ({
        courseId,
        ...(await getCourseContent(school, cookie, id, { typeFilter: typeFilter ?? "all", moduleTitle, maxDepth })),
      }))
  );
}

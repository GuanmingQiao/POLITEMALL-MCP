import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { SessionExpiredError, TokenRenewalError, D2lHttpError, PermissionDeniedError, NotFoundError } from "../api/errors.js";
import { D2lVersionDiscoveryError } from "../api/d2l-versions.js";
import { describeD2lFailure } from "../api/error-messages.js";
import { getCourseAccess, parseCourseId } from "../api/courses.js";
import { link } from "../utils/deep-links.js";
import { buildContent, unwrapLinked, type LinkOpts, type Source } from "./provenance.js";

// `sources` names the systems the data was read from; with it (and evidence links on) the result
// also says where and when it was read and which page to open. Without it the result is bare JSON.
export function toolResult(data: unknown, sources: Source[] = [], opts: LinkOpts = {}) {
  return { content: buildContent(data, sources, opts) };
}

export function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

// The credential for a school, or the message to give the caller instead (not connected, session
// ended, or D2L briefly unreachable).
export async function authFor(ctx: ToolContext, school: D2LSchool): Promise<{ ok: true; auth: string } | { ok: false; message: string }> {
  try {
    const auth = await ctx.getD2lAuth(school);
    if (!auth) return { ok: false, message: `Your ${school} session isn't connected. Sign in at ${ctx.connectUrl()}.` };
    return { ok: true, auth };
  } catch (err) {
    const message = await explainD2lError(ctx, err, school, "");
    if (message === undefined) throw err;
    return { ok: false, message };
  }
}

// Runs one read-only D2L operation with `holder.auth`. If D2L rejects that credential (a session
// error) the context gets one chance to supply a replacement, and the operation is repeated once
// with it; `holder.auth` is updated so later diagnosis uses the credential that was last tried.
// Anything else, a missing recover hook, no better credential, or a second rejection, goes to the
// caller exactly as before.
export async function withRecovery<T>(ctx: ToolContext, school: D2LSchool, holder: { auth: string }, run: (auth: string) => Promise<T>): Promise<T> {
  try {
    return await run(holder.auth);
  } catch (err) {
    if (!(err instanceof SessionExpiredError) || !ctx.recoverD2lAuth) throw err;
    const next = await ctx.recoverD2lAuth(school, holder.auth);
    if (!next) throw err;
    holder.auth = next;
    return await run(next);
  }
}

// Turns a failed D2L call into a message an agent can act on, or undefined if `err` isn't a
// D2L/session/version failure (a genuine bug — let it propagate). For 403/404 on a course-scoped
// call it also asks D2L for the caller's own enrollment: the HTTP status alone can't tell "not in
// this course" from "in it, but lacking permission / item missing / tool off".
export async function explainD2lError(
  ctx: ToolContext,
  err: unknown,
  school: D2LSchool,
  cookieHeader: string,
  courseId?: string
): Promise<string | undefined> {
  if (err instanceof SessionExpiredError) {
    await ctx.invalidateD2lAuth?.(school);
    return `Your ${school} session expired — sign in again at ${ctx.connectUrl()}.`;
  }
  if (err instanceof TokenRenewalError) {
    return `${err.message} This is temporary — try again shortly.`;
  }
  if (err instanceof D2lVersionDiscoveryError) {
    return `Couldn't determine which D2L API version ${school} supports right now (${err.message}). This is temporary — try again shortly.`;
  }
  if (err instanceof D2lHttpError) {
    console.warn(`D2L ${err.status} for ${school} ${err.route}${err.detail ? ` (${err.detail})` : ""}`);
    let access;
    if (courseId && (err instanceof PermissionDeniedError || err instanceof NotFoundError)) {
      try {
        access = await getCourseAccess(school, cookieHeader, parseCourseId(courseId).numericId);
      } catch {
        // Diagnosis is best-effort; fall back to the status-only message.
      }
    }
    return describeD2lFailure(err, { school, courseId, access });
  }
  return undefined;
}

// Runs fn against every D2L school (politemall/nyp) the caller has a saved session for,
// merging results. One school failing (expired session, a route that school's D2L rejects,
// an outage) doesn't fail the whole call — it's reported as a warning next to whatever data the
// other school(s) returned. `failed` counts schools that produced no data at all.
export async function runAcrossD2LSchools<T>(
  ctx: ToolContext,
  fn: (school: D2LSchool, cookieHeader: string) => Promise<T[]>
): Promise<{ results: T[]; warnings: string[]; attempted: number; failed: number; succeeded: D2LSchool[] }> {
  const schools = ctx.connectedSchools().filter((s): s is D2LSchool => s === "politemall" || s === "nyp");
  if (schools.length === 0) {
    return { results: [], warnings: [`No school connected yet. Sign in at ${ctx.connectUrl()}.`], attempted: 0, failed: 0, succeeded: [] };
  }

  const results: T[] = [];
  const warnings: string[] = [];
  const succeeded: D2LSchool[] = [];
  let attempted = 0;
  let failed = 0;
  for (const school of schools) {
    attempted++;
    const credential = await authFor(ctx, school);
    if (!credential.ok) {
      failed++;
      warnings.push(`${school}: ${credential.message}`);
      continue;
    }
    const holder = { auth: credential.auth };
    try {
      results.push(...(await withRecovery(ctx, school, holder, (auth) => fn(school, auth))));
      succeeded.push(school);
    } catch (err) {
      const message = await explainD2lError(ctx, err, school, holder.auth);
      if (message === undefined) throw err;
      failed++;
      warnings.push(`${school}: ${message}`);
    }
  }
  return { results, warnings, attempted, failed, succeeded };
}

// The link a cross-school result carries for the systems it read: one `pageUrl` for a single
// school, a `pageUrls` map when it spans both. Undefined links are left out.
export function schoolPages(schools: D2LSchool[], pageFor: (school: D2LSchool) => string | undefined): LinkOpts {
  const pages: Partial<Record<Source, string>> = {};
  for (const s of schools) {
    const url = pageFor(s);
    if (url) pages[s] = url;
  }
  const entries = Object.entries(pages);
  if (entries.length === 0) return {};
  return entries.length === 1 ? { pageUrl: entries[0][1] } : { pageUrls: pages };
}

// Wraps a cross-school tool's output. If every connected school failed there is no data to
// return, so that is an error rather than a success carrying only warnings. `decorate` adds the
// per-row evidence link / Singapore-time companions; `pageFor` names the page that shows the rows
// for a school (default: that school's home page).
export async function acrossSchoolsResult<T>(
  ctx: ToolContext,
  key: string,
  fn: (school: D2LSchool, cookieHeader: string) => Promise<T[]>,
  decorate?: (row: T) => T,
  pageFor: (school: D2LSchool) => string | undefined = (s) => link.schoolHome(s)
) {
  const { results, warnings, attempted, failed, succeeded } = await runAcrossD2LSchools(ctx, fn);
  if (attempted > 0 && failed === attempted) return errorResult(warnings.join("\n"));
  const rows = decorate ? results.map(decorate) : results;
  return toolResult({ [key]: rows, warnings: warnings.length ? warnings : undefined }, succeeded, schoolPages(succeeded, pageFor));
}

// Single-course D2L tools resolve which school a "school:numericId" courseId
// belongs to and use that school's cookie only.
export async function runForD2LCourse(
  ctx: ToolContext,
  courseId: string,
  fn: (school: D2LSchool, cookieHeader: string, numericId: number) => Promise<unknown>
) {
  const { school, numericId } = parseCourseId(courseId);
  const credential = await authFor(ctx, school);
  if (!credential.ok) return errorResult(credential.message);
  const holder = { auth: credential.auth };
  try {
    const { data, opts } = unwrapLinked(await withRecovery(ctx, school, holder, (auth) => fn(school, auth, numericId)));
    return toolResult(data, [school], opts);
  } catch (err) {
    const message = await explainD2lError(ctx, err, school, holder.auth, courseId);
    if (message === undefined) throw err;
    return errorResult(message);
  }
}

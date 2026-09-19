import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { SessionExpiredError, D2lHttpError, PermissionDeniedError, NotFoundError } from "../api/errors.js";
import { D2lVersionDiscoveryError } from "../api/d2l-versions.js";
import { describeD2lFailure } from "../api/error-messages.js";
import { getCourseAccess, parseCourseId } from "../api/courses.js";
import { SessionExpiredError as StepSessionExpiredError } from "../api/step-client.js";

export function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
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
    return `Your ${school} session expired — reconnect it at ${ctx.connectUrl()}.`;
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
): Promise<{ results: T[]; warnings: string[]; attempted: number; failed: number }> {
  const schools = ctx.connectedSchools().filter((s): s is D2LSchool => s === "politemall" || s === "nyp");
  if (schools.length === 0) {
    return { results: [], warnings: [`No school connected yet. Connect at least one at ${ctx.connectUrl()}.`], attempted: 0, failed: 0 };
  }

  const results: T[] = [];
  const warnings: string[] = [];
  let attempted = 0;
  let failed = 0;
  for (const school of schools) {
    const cookieHeader = ctx.getCookieHeader(school);
    if (!cookieHeader) continue;
    attempted++;
    try {
      results.push(...(await fn(school, cookieHeader)));
    } catch (err) {
      const message = await explainD2lError(ctx, err, school, cookieHeader);
      if (message === undefined) throw err;
      failed++;
      warnings.push(`${school}: ${message}`);
    }
  }
  return { results, warnings, attempted, failed };
}

// Wraps a cross-school tool's output. If every connected school failed there is no data to
// return, so that is an error rather than a success carrying only warnings.
export async function acrossSchoolsResult<T>(
  ctx: ToolContext,
  key: string,
  fn: (school: D2LSchool, cookieHeader: string) => Promise<T[]>
) {
  const { results, warnings, attempted, failed } = await runAcrossD2LSchools(ctx, fn);
  if (attempted > 0 && failed === attempted) return errorResult(warnings.join("\n"));
  return toolResult({ [key]: results, warnings: warnings.length ? warnings : undefined });
}

// Single-course D2L tools resolve which school a "school:numericId" courseId
// belongs to and use that school's cookie only.
export async function runForD2LCourse<T>(
  ctx: ToolContext,
  courseId: string,
  fn: (school: D2LSchool, cookieHeader: string, numericId: number) => Promise<T>
) {
  const { school, numericId } = parseCourseId(courseId);
  const cookieHeader = ctx.getCookieHeader(school);
  if (!cookieHeader) {
    return errorResult(`Your ${school} session isn't connected. Connect it at ${ctx.connectUrl()}.`);
  }
  try {
    return toolResult(await fn(school, cookieHeader, numericId));
  } catch (err) {
    const message = await explainD2lError(ctx, err, school, cookieHeader, courseId);
    if (message === undefined) throw err;
    return errorResult(message);
  }
}

export async function runStep<T>(ctx: ToolContext, fn: (cookieHeader: string) => Promise<T>) {
  const cookieHeader = ctx.getCookieHeader("step");
  if (!cookieHeader) {
    return errorResult(`Your STEP session isn't connected. Connect it at ${ctx.connectUrl()}.`);
  }
  try {
    return toolResult(await fn(cookieHeader));
  } catch (err) {
    if (err instanceof StepSessionExpiredError) {
      return errorResult(`Your STEP session expired — reconnect it at ${ctx.connectUrl()}.`);
    }
    throw err;
  }
}

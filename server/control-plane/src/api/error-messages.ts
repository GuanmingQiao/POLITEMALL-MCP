import { D2lHttpError, PermissionDeniedError, NotFoundError, BadRequestError } from "./errors.js";
import type { CourseAccess } from "../types/d2l.js";
import type { D2LSchool } from "../types/schools.js";

// Tools that return other people's data and need a grading role in the course. Named in
// permission errors so an agent can tell the user which tools need a different role.
const GRADER_TOOLS = "get_class_grades, get_all_final_grades, get_dropbox_submissions, get_quiz_results, get_survey_results";

export interface FailureContext {
  school: D2LSchool;
  // Present for course-scoped calls; lets the message name the course.
  courseId?: string;
  // The caller's own enrollment in that course, if it could be looked up.
  access?: CourseAccess;
}

function roleClause(access?: CourseAccess): string {
  if (!access) return "";
  if (!access.enrolled) return "";
  return access.role ? ` Your role in this course is "${access.role}".` : " You are enrolled in this course.";
}

const NOT_ENROLLED = (courseId: string) =>
  `Course ${courseId} was not found for your account: it doesn't exist, or you aren't enrolled in it. Use list_courses to see the courseIds you can use.`;

// Turns a D2L HTTP failure into something an agent can act on. Deliberately says only what is
// known: D2L answers 403/404 for several different situations, so where the status alone can't
// distinguish them the message names the candidates instead of asserting one.
export function describeD2lFailure(err: D2lHttpError, ctx: FailureContext): string {
  const where = ctx.courseId ?? `your ${ctx.school} account`;
  const notEnrolled = ctx.courseId !== undefined && ctx.access !== undefined && !ctx.access.enrolled;

  if (err instanceof PermissionDeniedError) {
    if (notEnrolled) return NOT_ENROLLED(ctx.courseId!);
    return (
      `D2L refused this request (403${err.detail ? `: "${err.detail}"` : ""}) for ${where}.${roleClause(ctx.access)} ` +
      `It needs a permission your account doesn't have — for the instructor/TA-only tools (${GRADER_TOOLS}) that means a grading role with access to that item. ` +
      `D2L also answers 403 (not 404) for some ids that don't exist, such as a dropbox folderId, so re-check any id you passed. ` +
      `This is not an expired session.`
    );
  }

  if (err instanceof NotFoundError) {
    if (notEnrolled) return NOT_ENROLLED(ctx.courseId!);
    if (ctx.courseId) {
      return (
        `D2L found nothing at this route (404) in ${ctx.courseId}.${roleClause(ctx.access)} ` +
        `Either the item id you passed (quizId, folderId, topicId, ...) doesn't exist in this course, or this D2L tool isn't enabled for the course. ` +
        `Re-check the id against the listing tool that returns it.`
      );
    }
    return `D2L found nothing at this route (404) for ${where}.`;
  }

  if (err instanceof BadRequestError) {
    return (
      `D2L rejected the request as invalid (400) for ${where}${err.detail ? `: ${err.detail}` : ""}. ` +
      `This usually means a parameter is missing or not accepted for this object; it is not a permission or session problem.`
    );
  }

  return `D2L returned an unexpected error (HTTP ${err.status}) for ${where}${err.detail ? `: ${err.detail}` : ""}. This is a D2L-side problem; retrying later may help.`;
}

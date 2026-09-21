// A decision for every registered tool about what evidence it carries, so that adding a tool
// without deciding fails a test rather than shipping silently unlinked. `fields` are the result
// fields a tool description must mention; `sgt` marks tools whose dates get a `...Sgt` companion.
// The reason column is the design decision (see openspec/changes/add-trust-metadata/design.md).
export type LinkField = "sourceUrl" | "pageUrl";
export interface LinkPolicy {
  kind: "item" | "page" | "none";
  fields: LinkField[];
  sgt: boolean;
  reason: string;
}

const item = (reason: string, sgt = false, pageToo = false): LinkPolicy => ({
  kind: "item",
  fields: pageToo ? ["sourceUrl", "pageUrl"] : ["sourceUrl"],
  sgt,
  reason,
});
const page = (reason: string, sgt = false): LinkPolicy => ({ kind: "page", fields: ["pageUrl"], sgt, reason });
const none = (reason: string): LinkPolicy => ({ kind: "none", fields: [], sgt: false, reason });

export const LINK_POLICY: Record<string, LinkPolicy> = {
  list_courses: item("course home per course"),
  get_course_content: item("content topic per topic; content root as the page", true, true),
  get_content_topic: item("the content topic", true),
  get_course_overview: page("course home"),
  get_grades: page("my grades page; there is no per-grade-item page", true),
  get_my_final_grade: page("my grades page"),
  get_class_grades: page("gradebook (grader-only)"),
  get_all_final_grades: page("gradebook (grader-only)"),
  get_announcements: item("announcement per item; announcements list as the page", true, true),
  get_calendar_events: item("D2L-supplied event page; course calendar as the page", true, true),
  get_my_calendar_events: item("D2L-supplied event page; school home as the page", true, true),
  get_assignments: item("assignment, quiz, or my grades for grade-only rows", true),
  get_assignment_files: item("the assignment", true, true),
  get_my_dropbox_submission: page("the assignment", true),
  get_dropbox_submissions: page("assignment folder page for a learner, assignments management for a grader", true),
  get_quizzes: item("quiz per item; quiz list as the page", true, true),
  get_quiz_attempts: page("the quiz", true),
  get_quiz_questions: page("the quiz"),
  get_quiz_results: page("quizzes management (grader-only)", true),
  get_surveys: item("survey per item; survey list as the page", true, true),
  get_survey_attempts: page("the survey", true),
  get_survey_questions: page("the survey"),
  get_survey_results: page("survey list (grader-only; the item-level grader page is unverified)", true),
  get_discussion_forums: page("discussions list"),
  get_discussion_topics: item("topic per item; discussions list as the page", true, true),
  get_discussion_posts: page("the discussion topic", true),
  get_classlist: page("classlist page; no per-person links"),
  get_groups: page("groups page"),
  get_rubrics: page("page of the assignment or topic the rubric is attached to, else course home"),
  get_due_items: item("course home per row; school home as the page", true, true),
  get_overdue_items: item("course home per row; school home as the page", true, true),
  get_recent_updates: item("course home per row; school home as the page", false, true),
  call_d2l_operation: none("raw catalog passthrough; only the retrieval statement is added"),
  list_d2l_operations: none("static catalog, nothing is read from a school"),
  search_politemall_catalog: none("the public marketing site; no verified per-item page"),
  list_step_courses: item("enrolled course page per course; my courses as the page", true, true),
  search_step_courses: item("catalogue course page per course (keyed on the catalogue id); All courses as the page", true, true),
  get_step_course_detail: item("enrolled course page; my courses as the page", true, true),
  get_step_timetable: item("enrolled course page, which lists the sessions; calendar as the page", true, true),
  get_step_announcements: page("STEP home, where the returned banner feed is shown (not the Announcements page)", true),
  whoami: page("STEP profile page; Brightspace identity has no page"),
};

// What is appended to a tool's description so an agent knows to cite the links.
export function linkDescription(policy: LinkPolicy | undefined): string {
  if (!policy || policy.kind === "none") return "";
  const parts: string[] = [];
  if (policy.fields.includes("sourceUrl")) parts.push("each item carries a `sourceUrl` (the page on the school's site that shows it)");
  if (policy.fields.includes("pageUrl")) parts.push("the result carries a `pageUrl` (the page that shows this data)");
  let text = ` Evidence links: ${parts.join(" and ")}. Cite these as inline links so the user can check; use only these, never build or edit a link, and say so when an item has none.`;
  if (policy.sgt) text += " Date fields also come with a `...Sgt` companion in Singapore time, which is what the site shows.";
  return text;
}

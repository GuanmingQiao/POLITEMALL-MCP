// Links into the Brightspace web UI, so an answer can point the user at the exact page. The
// templates are the ones the course pages themselves use (harvested by brightspace-mcp-server,
// MIT, (c) 2026 Rohan Muppa — see THIRD_PARTY_NOTICES.md). baseUrl is a tenant's origin.
const trim = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

export function assignmentUrl(baseUrl: string, courseId: number, folderId: number): string {
  return `${trim(baseUrl)}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${folderId}&grpid=0&ou=${courseId}`;
}

export function quizUrl(baseUrl: string, courseId: number, quizId: number): string {
  return `${trim(baseUrl)}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${quizId}&ou=${courseId}`;
}

// There is no per-column page a student may open, so every gradebook row in a course shares this.
export function gradebookUrl(baseUrl: string, courseId: number): string {
  return `${trim(baseUrl)}/d2l/lms/grades/my_grades/main.d2l?ou=${courseId}`;
}

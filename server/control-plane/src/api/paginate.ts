import type { D2LSchool } from "../types/schools.js";
import type { ObjectListPage, BookmarkPage } from "../types/d2l.js";
import { apiGet, SCHOOL_HOSTS } from "./d2l-client.js";

// Valence's ObjectListPage convention (distinct from the Bookmark-based paging
// enrollments/myenrollments uses) — follow the opaque "Next" URL until exhausted.
export async function fetchAllPages<T>(school: D2LSchool, path: string, cookieHeader: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = path;
  for (let page = 0; page < 20 && next; page++) {
    const page_: ObjectListPage<T> = await apiGet(school, next, cookieHeader);
    items.push(...page_.Objects);
    next = page_.Next ? page_.Next.replace(`https://${SCHOOL_HOSTS[school]}`, "") : null;
  }
  return items;
}

// Valence's PagedResultSet convention (Api.PagedResultSet — distinct from ObjectListPage
// above) — used by several catalog routes (e.g. le.grades.courseCompletionList,
// le.import.importLogs) that no curated tool touches today.
export async function fetchAllBookmarkPages<T>(school: D2LSchool, basePath: string, cookieHeader: string): Promise<T[]> {
  const items: T[] = [];
  let bookmark: string | null = null;
  for (let page = 0; page < 20; page++) {
    const path = bookmark
      ? `${basePath}${basePath.includes("?") ? "&" : "?"}bookmark=${encodeURIComponent(bookmark)}`
      : basePath;
    const page_: BookmarkPage<T> = await apiGet(school, path, cookieHeader);
    items.push(...page_.Items);
    if (!page_.PagingInfo.HasMoreItems || !page_.PagingInfo.Bookmark) break;
    bookmark = page_.PagingInfo.Bookmark;
  }
  return items;
}

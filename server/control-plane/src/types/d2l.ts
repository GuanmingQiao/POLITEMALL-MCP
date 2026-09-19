import type { D2LSchool } from "./schools.js";

export interface RichText {
  Text: string;
  Html: string;
}

// Valence's ObjectListPage convention — follow the opaque "Next" URL until exhausted.
export interface ObjectListPage<T> {
  Next: string | null;
  Objects: T[];
}

// Valence's PagedResultSet convention (distinct from ObjectListPage).
export interface BookmarkPage<T> {
  PagingInfo: { Bookmark: string | null; HasMoreItems: boolean };
  Items: T[];
}

export interface ClasslistUser {
  Identifier: string;
  DisplayName: string;
  Username: string | null;
  Email: string | null;
  FirstName?: string | null;
  LastName?: string | null;
  RoleId: number | null;
  ClasslistRoleDisplayName: string;
}

export interface Course {
  courseId: string;
  school: D2LSchool;
  name: string;
  code: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  lastAccessed: string | null;
}

export interface CourseAccess {
  enrolled: boolean;
  // ClasslistRoleName from the caller's own enrollment (e.g. "Learner", "Tutor"), if D2L named one.
  role: string | null;
  isActive: boolean | null;
}

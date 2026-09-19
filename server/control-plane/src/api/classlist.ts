import type { D2LSchool } from "../types/schools.js";
import type { ClasslistUser } from "../types/d2l.js";
import { apiGet } from "./d2l-client.js";
import { resolveD2lPath } from "./d2l-routes.js";

// The unpaged classlist (one request, every user). Several tools join it to attach names to
// user ids. D2L's own docs prefer the paged route, but it is 25 users a page — a 2,700-learner
// course would take over a hundred requests — so the single call wins here.
export async function fetchClasslist(school: D2LSchool, cookieHeader: string, orgUnitId: number): Promise<ClasslistUser[]> {
  return apiGet<ClasslistUser[]>(school, resolveD2lPath("le.classlist.list", {}, orgUnitId), cookieHeader);
}

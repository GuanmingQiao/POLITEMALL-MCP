import type { D2LSchool } from "../types/schools.js";
import { apiGet, versionedPath } from "./d2l-client.js";

// The caller's own D2L identity. Also the cheapest authenticated request there is, so the
// keep-alive sweep uses it to touch a session.
export async function d2lWhoami(school: D2LSchool, cookieHeader: string): Promise<unknown> {
  return apiGet(school, versionedPath("lp", "/users/whoami"), cookieHeader);
}

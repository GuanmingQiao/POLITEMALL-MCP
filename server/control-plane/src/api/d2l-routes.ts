import type { D2LSchool } from "../types/schools.js";
import { getRouteDescriptor } from "./route-catalog.js";
import { apiGet, apiGetFile, versionedPath } from "./d2l-client.js";
import { textLikeContent } from "../utils/file-text.js";
import { pageText } from "../utils/text-page.js";
import { fetchAllPages, fetchAllBookmarkPages } from "./paginate.js";
import { UnknownOperationError, InvalidRouteParamsError, UnsupportedOperationError } from "./errors.js";

// Builds the request path (e.g. "/d2l/api/le/{version}/6606/rubrics/42") for a cataloged
// operation; the version placeholder is filled in per tenant at request time (see apiGet).
// `pathParams` is validated against the catalog entry's declared schema — it must NOT include
// orgUnitId; for a course-scoped operation, `orgUnitId` is a separate argument the caller derives
// from a courseId, never from caller-supplied path params (closing off the class of bug where a
// valid session for one course probes another course's orgUnitId — see design.md Decision 3).
export function resolveD2lPath(operation: string, pathParams: Record<string, unknown> = {}, orgUnitId?: number): string {
  const descriptor = getRouteDescriptor(operation);
  if (!descriptor) {
    throw new UnknownOperationError(`Unknown D2L operation "${operation}"`);
  }

  const parsed = descriptor.pathParams.safeParse(pathParams);
  if (!parsed.success) {
    throw new InvalidRouteParamsError(`Invalid path params for "${operation}": ${parsed.error.message}`);
  }

  const substitutions: Record<string, unknown> = { ...parsed.data };
  if (descriptor.scope === "course") {
    if (orgUnitId === undefined) {
      throw new InvalidRouteParamsError(`Operation "${operation}" is course-scoped and requires an orgUnitId`);
    }
    substitutions.orgUnitId = orgUnitId;
  }

  let path = descriptor.pathTemplate;
  for (const [key, value] of Object.entries(substitutions)) {
    path = path.split(`{${key}}`).join(encodeURIComponent(String(value)));
  }
  if (/\{[a-zA-Z]+\}/.test(path)) {
    throw new InvalidRouteParamsError(`Unresolved path placeholder(s) for "${operation}": ${path}`);
  }

  return versionedPath(descriptor.product, path);
}

// Validates and serializes query params for a cataloged operation into a "?"-prefixed string
// (or "" if there are none / the operation declares no queryParams schema).
export function resolveD2lQuery(operation: string, queryParams: Record<string, unknown> = {}): string {
  const descriptor = getRouteDescriptor(operation);
  if (!descriptor) {
    throw new UnknownOperationError(`Unknown D2L operation "${operation}"`);
  }
  if (!descriptor.queryParams) return "";

  const parsed = descriptor.queryParams.safeParse(queryParams);
  if (!parsed.success) {
    throw new InvalidRouteParamsError(`Invalid query params for "${operation}": ${parsed.error.message}`);
  }

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    qs.set(key, String(value));
  }
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : "";
}

const MAX_TEXT_FILE_BYTES = 25 * 1024 * 1024;

// The catalog-driven dispatch behind call_d2l_operation. Unlike every curated tool, this returns
// the D2L response raw/unshaped — see design.md Decision 3.
export async function callD2lOperation(
  school: D2LSchool,
  cookieHeader: string,
  operation: string,
  pathParams: Record<string, unknown>,
  queryParams: Record<string, unknown>,
  orgUnitId?: number,
  paging: { offset?: number; maxChars?: number } = {}
): Promise<unknown> {
  const descriptor = getRouteDescriptor(operation);
  if (!descriptor) {
    throw new UnknownOperationError(`Unknown D2L operation "${operation}"`);
  }
  if (descriptor.pagination === "binary") {
    // A file route can still answer with a web page or text (a topic whose file is HTML): that is
    // returned as text, paged. Anything else is genuinely binary and is refused.
    const { bytes, contentType } = await apiGetFile(school, resolveD2lPath(operation, pathParams, orgUnitId) + resolveD2lQuery(operation, queryParams), cookieHeader, MAX_TEXT_FILE_BYTES);
    const text = textLikeContent(bytes, contentType);
    if (text === null) {
      throw new UnsupportedOperationError(
        `Operation "${operation}" returned binary file content (${contentType || "unknown type"}), which call_d2l_operation cannot return as text.`
      );
    }
    return { contentType, ...pageText(text, paging.offset, paging.maxChars) };
  }

  const path = resolveD2lPath(operation, pathParams, orgUnitId) + resolveD2lQuery(operation, queryParams);
  if (descriptor.pagination === "objectList") return fetchAllPages(school, path, cookieHeader);
  if (descriptor.pagination === "bookmark") return fetchAllBookmarkPages(school, path, cookieHeader);
  return apiGet(school, path, cookieHeader);
}

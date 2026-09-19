import type { D2LSchool } from "../types/schools.js";
import { getD2lVersions, type D2lProduct } from "./d2l-versions.js";
import { SessionExpiredError, D2lHttpError, PermissionDeniedError, NotFoundError, BadRequestError } from "./errors.js";

export const SCHOOL_HOSTS: Record<D2LSchool, string> = {
  politemall: "lms.polite.edu.sg",
  nyp: "nyplms.polite.edu.sg",
};

// Request paths are built version-less ("/d2l/api/le/{version}/6606/grades/") because the
// API version is a per-tenant fact discovered at runtime (see d2l-versions.ts). apiGet swaps the
// placeholder for the tenant's current version just before the request goes out.
export const VERSION_PLACEHOLDER = "{version}";
const VERSIONED_PREFIX = /^\/d2l\/api\/(le|lp)\/\{version\}/;

export function versionedPath(product: D2lProduct, rest: string): string {
  return `/d2l/api/${product}/${VERSION_PLACEHOLDER}${rest}`;
}

async function withVersion(school: D2LSchool, path: string): Promise<string> {
  const match = VERSIONED_PREFIX.exec(path);
  if (!match) return path;
  const product = match[1] as D2lProduct;
  const versions = await getD2lVersions(SCHOOL_HOSTS[school]);
  return `/d2l/api/${product}/${versions[product]}${path.slice(match[0].length)}`;
}

function routeOf(path: string): string {
  return path.replace(/^\/d2l\/api\//, "").split("?")[0];
}

async function problemDetail(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    try {
      // D2L uses two error body shapes: RFC 7807 problem details ({title, detail}) and
      // {"Errors":[{"Message":"..."}]}.
      const body = JSON.parse(text) as { detail?: unknown; title?: unknown; Errors?: { Message?: unknown }[] };
      const found = body.detail ?? body.Errors?.[0]?.Message ?? body.title;
      return typeof found === "string" ? found : undefined;
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return undefined;
  }
}

// Base URL of a tenant's web UI, for deep links.
export function schoolBaseUrl(school: D2LSchool): string {
  return `https://${SCHOOL_HOSTS[school]}`;
}

// Maps any non-200 answer to the right error. A dead/expired D2L session manifests as either a
// redirect to the login page (redirect: "manual" surfaces that as a 3xx here) or a 401 — anything
// else (500s, etc.) is a real server-side failure, not a session problem.
async function failFor(res: Response, resolvedPath: string): Promise<never> {
  if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
    throw new SessionExpiredError(`Request to ${routeOf(resolvedPath)} failed with status ${res.status}`);
  }
  const route = routeOf(resolvedPath);
  const detail = await problemDetail(res);
  const message = `D2L answered ${res.status} for ${route}${detail ? `: ${detail}` : ""}`;
  if (res.status === 403) throw new PermissionDeniedError(message, 403, route, detail);
  if (res.status === 404) throw new NotFoundError(message, 404, route, detail);
  if (res.status === 400) throw new BadRequestError(message, 400, route, detail);
  throw new D2lHttpError(message, res.status, route, detail);
}

export async function apiGet<T>(school: D2LSchool, path: string, cookieHeader: string): Promise<T> {
  const resolvedPath = await withVersion(school, path);
  const res = await fetch(`https://${SCHOOL_HOSTS[school]}${resolvedPath}`, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
    redirect: "manual",
  });
  if (res.status === 200) return (await res.json()) as T;
  return failFor(res, resolvedPath);
}

// A file was larger than the caller is willing to read into memory.
export class FileTooLargeError extends Error {
  constructor(readonly maxBytes: number, readonly sizeBytes?: number) {
    super(`File is larger than the ${maxBytes}-byte limit${sizeBytes ? ` (${sizeBytes} bytes)` : ""}`);
  }
}

// Downloads a binary body (e.g. an assignment attachment) into memory, never more than maxBytes:
// the declared Content-Length is checked first and the stream is cut off if it lies.
export async function apiGetBuffer(school: D2LSchool, path: string, cookieHeader: string, maxBytes: number): Promise<Buffer> {
  const resolvedPath = await withVersion(school, path);
  const res = await fetch(`https://${SCHOOL_HOSTS[school]}${resolvedPath}`, {
    headers: { Cookie: cookieHeader, Accept: "*/*" },
    redirect: "manual",
  });
  if (res.status !== 200) return failFor(res, resolvedPath);

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new FileTooLargeError(maxBytes, declared);
  }
  if (!res.body) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FileTooLargeError(maxBytes, total);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

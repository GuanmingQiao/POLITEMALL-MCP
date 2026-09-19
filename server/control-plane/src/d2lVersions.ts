// Discovers which D2L Valence API versions each tenant supports instead of pinning them.
//
// GET https://<host>/d2l/api/versions/ is callable anonymously and lists every product
// (le, lp, bas, ...) with its SupportedVersions and LatestVersion. We use the newest
// supported version of the two products this server calls ("le" and "lp"): older versions
// have real bugs on some routes (e.g. le 1.9 answers 400 for grades/final/values/ and 404
// for quizzes/surveys where 1.75+ answers 200), so a stale pin silently breaks tools.
//
// Discovery is lazy and cached: nothing needs a version until the first D2L request for a
// tenant, and a tenant only upgrades its API every few months, so a long TTL is fine.

export type D2lProduct = "le" | "lp";
export interface D2lVersions {
  le: string;
  lp: string;
}

// Neither the network nor D2L's versions document could produce a usable answer, and there is
// no earlier answer to fall back on. Distinct from a tool failing: nothing was requested yet.
export class D2lVersionDiscoveryError extends Error {}

const TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

interface ProductVersions {
  ProductCode: string;
  LatestVersion: string;
  SupportedVersions: string[];
}

interface CacheEntry {
  versions: D2lVersions;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<D2lVersions>>();

// "1.10" > "1.9" — compare dotted numeric versions numerically, never lexically.
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function pickLatest(product: ProductVersions): string {
  const candidates = [...(product.SupportedVersions ?? []), product.LatestVersion].filter(
    (v): v is string => typeof v === "string" && /^\d+(\.\d+)*$/.test(v)
  );
  if (candidates.length === 0) throw new D2lVersionDiscoveryError(`no usable versions listed for "${product.ProductCode}"`);
  return candidates.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

// Operator escape hatch: pin a product back to a known-good version (e.g. if a newer version
// changes a response shape a curated tool depends on) without a code change.
function envOverride(product: D2lProduct): string | undefined {
  const v = process.env[`D2L_${product.toUpperCase()}_VERSION`];
  return v && /^\d+(\.\d+)*$/.test(v) ? v : undefined;
}

async function discover(host: string): Promise<D2lVersions> {
  let res: Response;
  try {
    res = await fetch(`https://${host}/d2l/api/versions/`, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new D2lVersionDiscoveryError(`could not reach ${host}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    throw new D2lVersionDiscoveryError(`${host} answered ${res.status} for its versions list`);
  }
  let list: ProductVersions[];
  try {
    list = (await res.json()) as ProductVersions[];
  } catch {
    throw new D2lVersionDiscoveryError(`${host} returned a versions list that isn't valid JSON`);
  }
  if (!Array.isArray(list)) {
    throw new D2lVersionDiscoveryError(`${host} returned an unexpected versions list shape`);
  }

  const find = (code: D2lProduct): string => {
    const override = envOverride(code);
    if (override) return override;
    const product = list.find((p) => p.ProductCode === code);
    if (!product) throw new D2lVersionDiscoveryError(`${host} does not list the "${code}" API product`);
    return pickLatest(product);
  };
  return { le: find("le"), lp: find("lp") };
}

export async function getD2lVersions(host: string): Promise<D2lVersions> {
  const cached = cache.get(host);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.versions;

  // Concurrent tool calls (and the boot warm-up) share one request per tenant.
  let pending = inflight.get(host);
  if (!pending) {
    pending = discover(host)
      .then((versions) => {
        cache.set(host, { versions, fetchedAt: Date.now() });
        return versions;
      })
      .catch((err: unknown) => {
        // A stale answer beats failing every tool because the versions list blipped.
        if (cached) {
          console.warn(`D2L version refresh failed for ${host}, keeping ${JSON.stringify(cached.versions)}: ${String(err)}`);
          // Retry in a few minutes rather than on every call while the list is unreachable.
          cache.set(host, { versions: cached.versions, fetchedAt: Date.now() - TTL_MS + RETRY_AFTER_FAILURE_MS });
          return cached.versions;
        }
        throw err;
      })
      .finally(() => inflight.delete(host));
    inflight.set(host, pending);
  }
  return pending;
}

// Boot-time warm-up: log what each tenant resolves to and surface problems early, but never
// block startup — a tenant that is briefly unreachable at boot is retried on first use.
export async function warmD2lVersions(hosts: string[]): Promise<void> {
  const results = await Promise.allSettled(hosts.map((h) => getD2lVersions(h)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      console.log(`D2L API versions for ${hosts[i]}: le ${r.value.le}, lp ${r.value.lp}`);
    } else {
      console.warn(`D2L version discovery failed for ${hosts[i]} at boot (will retry on first use): ${String(r.reason)}`);
    }
  });
}

// Test hooks.
export function primeD2lVersions(host: string, versions: D2lVersions): void {
  cache.set(host, { versions, fetchedAt: Date.now() });
}
export function resetD2lVersionCache(): void {
  cache.clear();
  inflight.clear();
}

import { SCHOOL_HOSTS, LE_VERSION, LP_VERSION } from "./d2l.js";

// Run once at process boot (see index.ts), not per request — see design.md Decision 5.
// GET /d2l/api/(productCode)/versions/(version) is documented as callable anonymously,
// confirmed directly against the Valence docs, so no session cookie is needed here.

// The pinned version is confirmed unsupported by a reachable tenant — a deploy-time signal
// to bump LE_VERSION/LP_VERSION in d2l.ts, distinct from a tenant simply being unreachable.
export class VersionUnsupportedError extends Error {}
// The tenant could not be reached or returned something other than a normal 200/JSON
// response — an infrastructure problem, not evidence the pinned version is wrong.
export class VersionCheckUnreachableError extends Error {}

interface SupportedVersionResponse {
  Supported: boolean;
  LatestVersion: string;
}

async function checkOne(host: string, product: "le" | "lp", version: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`https://${host}/d2l/api/${product}/versions/${version}`, {
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new VersionCheckUnreachableError(
      `Could not reach ${host} to verify ${product.toUpperCase()} version ${version} is supported: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (!res.ok) {
    throw new VersionCheckUnreachableError(
      `Version check against ${host} for ${product.toUpperCase()} ${version} failed with unexpected status ${res.status}`
    );
  }

  const data = (await res.json()) as SupportedVersionResponse;
  if (!data.Supported) {
    throw new VersionUnsupportedError(
      `${host} no longer supports D2L ${product.toUpperCase()} API version ${version} (its latest supported version is ${
        data.LatestVersion
      }) — bump LE_VERSION/LP_VERSION in d2l.ts and verify curated tool response shapes before redeploying`
    );
  }
}

// Checks every connectable school host against both pinned product versions. Throws
// synchronously (well, rejects) on the first failure — called at module top-level in
// index.ts, before app.listen, so an unsupported or unreachable pin blocks the whole
// process from starting rather than surfacing later as scattered tool-call failures.
export async function checkD2lVersionCompatibility(): Promise<void> {
  const hosts = Object.values(SCHOOL_HOSTS);
  await Promise.all(hosts.flatMap((host) => [checkOne(host, "le", LE_VERSION), checkOne(host, "lp", LP_VERSION)]));
}

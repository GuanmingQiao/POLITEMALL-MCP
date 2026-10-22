import { isIP } from "node:net";

// What the streamed sign-in browser may request. Navigations (main frame, subframes, every redirect
// hop) are enforced strictly: they are what delivers an attacker-controlled page. Page resources on
// other public hosts are allowed but reported, because Microsoft's pages pull from CDNs whose names
// are not fully known. Requests to non-public addresses and unexpected schemes are always blocked.

export type NetDecision = "allow" | "block" | "report";

// Microsoft's sign-in hosts; "*." entries match any subdomain.
export const MICROSOFT_ALLOWED = [
  "login.microsoftonline.com",
  "login.live.com",
  "*.microsoftonline.com",
  "*.msauth.net",
  "*.msftauth.net",
  "*.microsoft.com",
  "*.live.com",
];

// The schools' own domain: the LMS hosts hand sign-in to sibling hosts such as loginhub.polite.edu.sg.
export const SCHOOL_ALLOWED = ["polite.edu.sg", "*.polite.edu.sg"];

export function hostMatches(host: string, patterns: Iterable<string>): boolean {
  for (const p of patterns) {
    if (p.startsWith("*.") ? host.endsWith(p.slice(1)) : host === p) return true;
  }
  return false;
}

function ipv4Private(parts: number[]): boolean {
  const [a, b] = parts;
  return (
    a === 0 || // unspecified / "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

// Expands an IPv6 literal (no brackets) into eight 16-bit groups, or null when malformed.
function ipv6Groups(host: string): number[] | null {
  let h = host;
  const tail = h.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const o = tail[1].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    h = h.slice(0, -tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  const groups = all.map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function ipv6Private(host: string): boolean {
  const g = ipv6Groups(host);
  if (!g) return true; // unparseable: refuse
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded address.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return ipv4Private([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
  }
  return false;
}

// True for hosts that are on the server's own side of the network: IP literals in non-public
// ranges, localhost names, internal names, and single-label names (which would resolve to Docker
// service names such as `control-plane` or `caddy`).
export function isNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const kind = isIP(bare);
  if (kind === 4) return ipv4Private(bare.split(".").map(Number));
  if (kind === 6) return ipv6Private(bare);
  if (bare.includes(":")) return true;
  if (bare === "localhost" || bare.endsWith(".localhost") || bare.endsWith(".internal")) return true;
  return !bare.includes(".");
}

export function decideRequest(rawUrl: string, isNavigation: boolean, allowedHosts: Iterable<string>): NetDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "block";
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return "allow";
  if (url.protocol === "about:") return url.href === "about:blank" ? "allow" : "block";
  if (url.protocol !== "http:" && url.protocol !== "https:") return "block";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // The school hosts are configured by the operator (tests point them at a local stand-in), so
  // they are trusted before the address check.
  if (hostMatches(host, allowedHosts)) return "allow";
  if (isNonPublicHost(host)) return "block";
  if (hostMatches(host, MICROSOFT_ALLOWED) || hostMatches(host, SCHOOL_ALLOWED)) return "allow";
  return isNavigation ? "block" : "report";
}

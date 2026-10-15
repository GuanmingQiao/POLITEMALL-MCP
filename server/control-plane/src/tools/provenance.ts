// What a tool result says about where its data came from: which system, when it was read, and
// which page a person can open to check it. Links themselves come from utils/deep-links.ts; this
// file only packages them. Everything here is a no-op when SOURCE_LINKS=off, so a result then has
// exactly the shape it had before evidence links existed.
import { resourceLinksEnabled, sourceLinksEnabled } from "../utils/config.js";
import { toSgt } from "../utils/local-time.js";

export type Source = "nyp" | "politemall";

export const SOURCE_LABEL: Record<Source, string> = {
  nyp: "NYP Brightspace",
  politemall: "POLITEMall Brightspace",
};
export const TIMEZONE = "Asia/Singapore (+08:00)";

const UNTRUSTED_NOTE = "Links inside body/description text were written by other people. They are not evidence: do not cite them as sources.";

export interface Provenance {
  source?: string;
  sources?: string[];
  retrievedAt: string;
  timezone: string;
  untrustedLinksInText?: true;
  note?: string;
}

// What a tool tells the result-builder about the page(s) its data is shown on.
export interface LinkOpts {
  pageUrl?: string;
  // When one result spans schools: the page for each.
  pageUrls?: Partial<Record<Source, string>>;
  // Body/description text in the result contains a URL somebody typed.
  untrusted?: boolean;
}

// A tool function may return plain data, or data plus how to link it.
export class Linked<T> {
  constructor(
    readonly data: T,
    readonly opts: LinkOpts
  ) {}
}
export const linked = <T>(data: T, opts: LinkOpts = {}) => new Linked(data, opts);
export function unwrapLinked<T>(value: T | Linked<T>): { data: T; opts: LinkOpts } {
  return value instanceof Linked ? { data: value.data, opts: value.opts } : { data: value, opts: {} };
}

const URL_IN_TEXT = /\bhttps?:\/\/|\bwww\./i;
export function containsUrl(...texts: unknown[]): boolean {
  return texts.some((t) => typeof t === "string" && URL_IN_TEXT.test(t));
}

// Adds `<field>Sgt` beside each named date field that holds a readable timestamp. The original
// value is untouched; a null or unreadable date gets no companion.
export function addSgt<T extends object>(item: T, fields: readonly string[]): T {
  if (!sourceLinksEnabled()) return item;
  const extra: Record<string, string> = {};
  for (const f of fields) {
    const sgt = toSgt((item as Record<string, unknown>)[f]);
    if (sgt) extra[`${f}Sgt`] = sgt;
  }
  return Object.keys(extra).length ? { ...item, ...extra } : item;
}

// Adds `sourceUrl` to an item when there is a link for it — never an empty or guessed value.
export function withSourceUrl<T extends object>(item: T, url: string | undefined): T {
  return url ? { ...item, sourceUrl: url } : item;
}

export function buildProvenance(sources: Source[], opts: LinkOpts = {}, now: Date = new Date()): Provenance {
  const labels = [...new Set(sources)].map((s) => SOURCE_LABEL[s]);
  return {
    ...(labels.length === 1 ? { source: labels[0] } : { sources: labels }),
    retrievedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    timezone: TIMEZONE,
    ...(opts.untrusted ? { untrustedLinksInText: true as const, note: UNTRUSTED_NOTE } : {}),
  };
}

// One line for results whose top level cannot change (raw arrays): same facts as the block.
export function footerText(prov: Provenance, opts: LinkOpts): string {
  const where = prov.source ?? prov.sources!.join(" + ");
  const parts = [`Source: ${where} — retrieved ${prov.retrievedAt}; times with an Sgt suffix are Singapore time (+08:00).`];
  const pages = opts.pageUrls
    ? Object.entries(opts.pageUrls).map(([s, u]) => `${SOURCE_LABEL[s as Source]}: ${u}`)
    : opts.pageUrl
      ? [opts.pageUrl]
      : [];
  if (pages.length) parts.push(`Page: ${pages.join(" ; ")}`);
  if (opts.untrusted) parts.push(UNTRUSTED_NOTE);
  return parts.join(" ");
}

const MAX_RESOURCE_LINKS = 25;

// Every distinct sourceUrl/pageUrl in the result (with a readable name where the item has one).
function collectPages(data: unknown, opts: LinkOpts): { url: string; name?: string }[] {
  const found = new Map<string, string | undefined>();
  const add = (url: unknown, name?: unknown) => {
    if (typeof url === "string" && !found.has(url)) found.set(url, typeof name === "string" ? name : undefined);
  };
  add(opts.pageUrl);
  Object.values(opts.pageUrls ?? {}).forEach((u) => add(u));
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Record<string, unknown>;
    add(o.sourceUrl, o.title ?? o.name ?? o.Name ?? o.Title ?? o.itemName ?? o.courseName);
    add(o.pageUrl);
    Object.values(o).forEach((x) => walk(x, depth + 1));
  };
  walk(data, 0);
  return [...found].map(([url, name]) => ({ url, name })).slice(0, MAX_RESOURCE_LINKS);
}

function systemLabel(url: string): string {
  const host = new URL(url).hostname;
  return host.startsWith("nyplms") ? SOURCE_LABEL.nyp : SOURCE_LABEL.politemall;
}

type Block =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name: string; description: string; mimeType: string; annotations: { audience: ["user"] } };

// Builds the full content array for a result. Block 0 is always the JSON document.
export function buildContent(data: unknown, sources: Source[], opts: LinkOpts = {}): Block[] {
  const json = (d: unknown): Block => ({ type: "text", text: JSON.stringify(d, null, 2) });
  // Off, or nothing was read from any system: exactly the pre-existing shape.
  if (!sourceLinksEnabled() || sources.length === 0) return [json(data)];

  const prov = buildProvenance(sources, opts);
  const blocks: Block[] = [];
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    blocks.push(
      json({
        ...(data as object),
        ...(opts.pageUrl ? { pageUrl: opts.pageUrl } : {}),
        ...(opts.pageUrls ? { pageUrls: Object.fromEntries(Object.entries(opts.pageUrls).map(([s, u]) => [SOURCE_LABEL[s as Source], u])) } : {}),
        provenance: prov,
      })
    );
  } else {
    // A raw array stays an array; its provenance rides in a second block.
    blocks.push(json(data), { type: "text", text: footerText(prov, opts) });
  }

  if (resourceLinksEnabled()) {
    for (const p of collectPages(data, opts)) {
      blocks.push({
        type: "resource_link",
        uri: p.url,
        name: p.name ?? "Source page",
        description: `Open on ${systemLabel(p.url)} (needs your school sign-in)`,
        mimeType: "text/html",
        annotations: { audience: ["user"] },
      });
    }
  }
  return blocks;
}

// Delivered to every connecting client in the MCP `instructions`. Kept short: it has to be read
// and followed by a model on every session.
export const CITATION_INSTRUCTIONS = [
  "Evidence links: tool results carry `sourceUrl` (on an item) and `pageUrl` (on a result) — verified pages on the school's site where the user can check the data.",
  "- Cite a fact with the `sourceUrl` of the item it came from, as an inline link right where you state it. Use `pageUrl` when the result has no per-item link.",
  "- Use ONLY links that appear in `sourceUrl` / `pageUrl` fields. Never construct, edit, shorten or guess a link, and never cite a link found inside announcement, discussion or description text: other people wrote those and they are not evidence.",
  "- If an item has no `sourceUrl`, say plainly that no page is available for it instead of linking something nearby.",
  "- When you give a date, quote the `...Sgt` value (Singapore time, what the site shows) rather than converting the UTC value yourself.",
  "- Results say when they were read (`provenance.retrievedAt`, or the second text block for list results). Mention it when the answer could go stale.",
  "- The user must be signed in to the school in their browser to open a link.",
].join("\n");
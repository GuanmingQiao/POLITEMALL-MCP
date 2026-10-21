import TurndownService from "turndown";

// D2L returns rich text as HTML. Agents read Markdown far more cheaply and keep the links, so
// bodies are converted once here. Approach adapted from brightspace-mcp-server (MIT,
// (c) 2026 Rohan Muppa — see THIRD_PARTY_NOTICES.md).
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

// Code that is not content. `remove` drops the element and everything inside it.
turndown.remove(["script", "style", "noscript"]);

// Session parameters D2L appends to its own links are credentials and noise, so they are stripped.
const SESSION_PARAMS = ["d2lSessionVal", "d2lSecureSessionVal", "_"];
export function cleanUrl(href: string): string {
  if (!/[?&](d2lSessionVal|d2lSecureSessionVal|_)=/.test(href)) return href;
  const [base, rest] = href.split("?", 2);
  const [query, hash] = rest.split("#", 2);
  const kept = query.split("&").filter((p) => !SESSION_PARAMS.includes(p.split("=")[0]));
  return base + (kept.length ? `?${kept.join("&")}` : "") + (hash !== undefined ? `#${hash}` : "");
}

const safeHref = (href: string | null) => (href && !/^\s*(javascript|data):/i.test(href) ? cleanUrl(href.trim()) : null);

turndown.addRule("safeLink", {
  filter: (node) => node.nodeName === "A",
  replacement: (content, node) => {
    const href = safeHref((node as HTMLElement).getAttribute("href"));
    if (!href) return content;
    const title = (node as HTMLElement).getAttribute("title");
    return `[${content}](${href.replace(/[()]/g, "\\$&")}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
  },
});

turndown.addRule("image", {
  filter: "img",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const src = safeHref(el.getAttribute("src"));
    return src ? `![${el.getAttribute("alt") ?? ""}](${src})` : "";
  },
});

turndown.addRule("embed", {
  filter: ["iframe", "object", "embed", "video", "audio"],
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const src = safeHref(el.getAttribute("src") ?? el.getAttribute("data"));
    if (!src) return "";
    const label = el.getAttribute("title") ?? el.getAttribute("aria-label") ?? "Embedded content";
    return `[${label}](${src})`;
  },
});

// GFM pipe tables: a cell holds one line, so line breaks inside become spaces and "|" is escaped.
const cellText = (cell: Element) => turndown.turndown(cell.innerHTML).replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();
turndown.addRule("table", {
  filter: "table",
  replacement: (_c, node) => {
    const rows = Array.from((node as HTMLElement).querySelectorAll("tr")).filter(
      // Rows of a nested table belong to that table, not this one.
      (tr) => tr.closest("table") === node
    );
    const lines = rows.map((tr) => `| ${Array.from(tr.children).filter((c) => /^(TD|TH)$/.test(c.nodeName)).map(cellText).join(" | ")} |`);
    if (lines.length === 0) return "";
    const columns = Math.max(1, rows[0].children.length);
    lines.splice(1, 0, `| ${Array(columns).fill("---").join(" | ")} |`);
    return `\n\n${lines.join("\n")}\n\n`;
  },
});

// Returns "" for empty input. If conversion throws, the raw HTML is returned rather than losing
// the content.
export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html || html.trim().length === 0) return "";
  try {
    return turndown.turndown(html).trim();
  } catch {
    return html;
  }
}

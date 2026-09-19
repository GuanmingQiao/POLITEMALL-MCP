import TurndownService from "turndown";

// D2L returns rich text as HTML. Agents read Markdown far more cheaply and keep the links, so
// bodies are converted once here. Approach adapted from brightspace-mcp-server (MIT,
// (c) 2026 Rohan Muppa — see THIRD_PARTY_NOTICES.md).
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

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

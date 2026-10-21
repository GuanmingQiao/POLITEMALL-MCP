import { htmlToMarkdown } from "./html-to-markdown.js";

const HTML_START = /^<(!doctype\s+html|html|head|body|meta|title|style|script|div|p|h[1-6]|table|ul|ol|section|article|span|a|img|br)[\s>/]/i;

// Decodes UTF-8 (or UTF-16 with a BOM); null when the bytes are not text.
export function decodeText(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// Whether downloaded bytes are an HTML page or plain text (including JSON). The bytes decide; the
// Content-Type only breaks ties, because D2L sometimes mislabels files.
export function detectTextKind(bytes: Buffer, contentType = ""): "html" | "text" | null {
  const text = decodeText(bytes);
  if (text === null) return null;
  const type = contentType.toLowerCase();
  if (type.includes("text/html") || HTML_START.test(text.trimStart())) return "html";
  return type.startsWith("text/") || type.includes("json") ? "text" : null;
}

// Readable text of a text-like file (HTML becomes Markdown), or null when it is not text-like.
export function textLikeContent(bytes: Buffer, contentType = ""): string | null {
  const kind = detectTextKind(bytes, contentType);
  if (!kind) return null;
  const text = decodeText(bytes) ?? "";
  return kind === "html" ? htmlToMarkdown(text) : text.trim();
}

import { inflateRawSync } from "node:zlib";

// A dependency-free reader for the one thing we need out of a ZIP: named entries. DOCX, XLSX and
// PPTX are ZIP archives, and reading them is what makes an attachment useful rather than just
// listed. Approach adapted from brightspace-mcp-server (MIT, (c) 2026 Rohan Muppa — see
// THIRD_PARTY_NOTICES.md). Hardened for a shared server: attachments are untrusted input, so an
// entry that would inflate past MAX_ENTRY_BYTES (a zip bomb) is refused rather than expanded.
//
// The central directory is the index and is what this walks; scanning for local-header magic is
// wrong because those bytes can appear inside compressed content. Nothing here throws: a
// truncated download, unsupported compression, ZIP64 or an oversized entry all yield null, and
// the caller reports the file without its text.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT = 0xffff;
const ZIP64_MARKER = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEocd(buffer: Buffer): number | null {
  const earliest = Math.max(0, buffer.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT);
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= earliest; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return null;
}

function readCentralDirectory(buffer: Buffer): CentralEntry[] | null {
  const eocd = findEocd(buffer);
  if (eocd === null) return null;

  const count = buffer.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) return null;
  let offset = buffer.readUInt32LE(eocd + 16);
  if (offset === ZIP64_MARKER) return null; // ZIP64 is out of scope.

  const entries: CentralEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length) return null;
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_SIGNATURE) return null;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const nameStart = offset + 46;
    if (nameStart + nameLength > buffer.length) return null;

    entries.push({
      name: buffer.subarray(nameStart, nameStart + nameLength).toString("utf-8"),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntryData(buffer: Buffer, entry: CentralEntry): Buffer | null {
  // The declared size is a claim, not a fact — but a claim past the cap is enough to refuse.
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) return null;

  const header = entry.localHeaderOffset;
  if (header + 30 > buffer.length) return null;

  // The local header repeats the name/extra lengths, and its extra field can differ in length
  // from the central one, so read them from here.
  const nameLength = buffer.readUInt16LE(header + 26);
  const extraLength = buffer.readUInt16LE(header + 28);
  const start = header + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) return null;

  const raw = buffer.subarray(start, end);
  if (entry.method === METHOD_STORED) return raw.length <= MAX_ENTRY_BYTES ? Buffer.from(raw) : null;
  if (entry.method !== METHOD_DEFLATE) return null;

  try {
    // maxOutputLength makes inflate fail instead of expanding a bomb into memory.
    return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
  } catch {
    return null;
  }
}

export function extractZipEntry(buffer: Buffer, entryName: string): Buffer | null {
  try {
    const entry = readCentralDirectory(buffer)?.find((e) => e.name === entryName);
    return entry ? readEntryData(buffer, entry) : null;
  } catch {
    return null;
  }
}

export function listZipEntries(buffer: Buffer): string[] | null {
  try {
    return readCentralDirectory(buffer)?.map((e) => e.name) ?? null;
  } catch {
    return null;
  }
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };

// Strip XML markup down to the words. Paragraph and cell boundaries become spaces so words from
// adjacent runs don't fuse.
function xmlToText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const slideNumber = (name: string) => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);

// Readable text from a DOCX, XLSX or PPTX buffer, or null when the archive isn't an Office
// document or holds nothing readable.
export function officeDocumentText(buffer: Buffer): string | null {
  const names = listZipEntries(buffer);
  if (!names) return null;
  const read = (name: string): string => xmlToText(extractZipEntry(buffer, name)?.toString("utf-8") ?? "");

  let text: string;
  if (names.includes("word/document.xml")) {
    text = read("word/document.xml");
  } else if (names.includes("xl/sharedStrings.xml")) {
    text = read("xl/sharedStrings.xml");
  } else if (names.some((n) => n.startsWith("ppt/slides/slide"))) {
    text = names
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => slideNumber(a) - slideNumber(b))
      .map(read)
      .filter(Boolean)
      .join("\n\n");
  } else {
    return null;
  }
  return text.length > 0 ? text : null;
}

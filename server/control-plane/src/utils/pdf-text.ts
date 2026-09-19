import { extractText } from "unpdf";

const TIMEOUT_MS = 20_000;

// Text from a PDF buffer, or null if it can't be read (scanned image, damaged, encrypted, or too
// slow). Untrusted input on a shared server, so parsing is bounded in time and never throws.
// Approach adapted from brightspace-mcp-server (MIT, (c) 2026 Rohan Muppa).
export async function extractPdfText(buffer: Buffer): Promise<{ text: string; totalPages: number } | null> {
  try {
    const result = await Promise.race([
      extractText(new Uint8Array(buffer), { mergePages: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pdf parse timed out")), TIMEOUT_MS).unref()),
    ]);
    return { text: result.text as string, totalPages: result.totalPages };
  } catch {
    return null;
  }
}

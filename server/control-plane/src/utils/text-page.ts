// Long extracted text is returned in bounded, resumable slices (spec: d2l-text-paging). Slicing is
// by UTF-16 character, so the pieces concatenate back to the original exactly.
export const DEFAULT_MAX_CHARS = 20000;
export const MAX_MAX_CHARS = 100000;

export interface TextPage {
  text: string;
  totalChars: number;
  truncated: boolean;
  // Where to continue; present only when more text remains.
  nextOffset?: number;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

export function pageText(text: string, offset = 0, maxChars = DEFAULT_MAX_CHARS): TextPage {
  const totalChars = text.length;
  const start = Math.min(Math.max(0, Math.floor(offset)), totalChars);
  let end = Math.min(totalChars, start + Math.max(1, Math.floor(maxChars)));
  // Never end between the two halves of a surrogate pair.
  if (end < totalChars && end > start + 1 && isHighSurrogate(text.charCodeAt(end - 1))) end--;
  const truncated = end < totalChars;
  return { text: text.slice(start, end), totalChars, truncated, ...(truncated ? { nextOffset: end } : {}) };
}

// Singapore has no daylight saving, so a fixed +08:00 is exact. Brightspace shows
// times in Singapore time while its API sends UTC; a due date read straight from the API
// looks eight hours wrong next to the page, so tools add this as a companion, never a replacement.
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;
const SGT_MS = 8 * 60 * 60 * 1000;

// The same instant as `YYYY-MM-DDTHH:mm:ss+08:00`; undefined for null, non-strings, and anything
// without an explicit offset (a bare local time would be a guess).
export function toSgt(iso: unknown): string | undefined {
  if (typeof iso !== "string" || !WITH_OFFSET.test(iso)) return undefined;
  const ms = Date.parse(iso);
  // Unset timestamps can come back as 0001-01-01; that is "no date", not a date to convert.
  if (Number.isNaN(ms) || ms < Date.UTC(1900, 0, 1)) return undefined;
  return new Date(ms + SGT_MS).toISOString().replace(/\.\d{3}Z$/, "+08:00");
}

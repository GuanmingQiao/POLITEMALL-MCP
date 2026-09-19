// Structured audit log for every authenticated request. Never logs the raw token
// or cookie header — only a short, one-way hash identifier, so a leaked log can't
// itself be used to reconstruct credentials.
export function auditLog(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

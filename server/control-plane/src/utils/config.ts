// LOCAL_MODE=1 runs the very same server (same tools, same routes) on your own machine with no
// AWS: the master key lives in a file next to the token store and the public origin defaults to
// localhost. Everything else behaves identically to the hosted deployment.
const local = process.env.LOCAL_MODE === "1";
const port = Number(process.env.PORT ?? 3000);

// on/off switches: anything other than an explicit on/off value (unset, blank, junk) is the default.
export function parseSwitch(raw: string | undefined, defaultOn: boolean): boolean {
  const v = raw?.trim().toLowerCase();
  if (v === "on" || v === "1" || v === "true") return true;
  if (v === "off" || v === "0" || v === "false") return false;
  return defaultOn;
}

// Evidence links, provenance, Singapore-time companions and citation guidance. Read on every call
// so the switch works without touching code.
export function sourceLinksEnabled(): boolean {
  return parseSwitch(process.env.SOURCE_LINKS, true);
}
// Also emit MCP resource_link blocks (clients differ in whether they show them). Only meaningful
// while sourceLinksEnabled().
export function resourceLinksEnabled(): boolean {
  return sourceLinksEnabled() && parseSwitch(process.env.SOURCE_RESOURCE_LINKS, false);
}

export const config = {
  local,
  port,
  awsRegion: process.env.AWS_REGION ?? "ap-southeast-1",
  masterKeySecretId: process.env.MASTER_KEY_SECRET_ID ?? "politemall-mcp/master-key",
  storeFile: process.env.STORE_FILE ?? (local ? "./data/tokens.json" : "/data/tokens.json"),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? (local ? `http://localhost:${port}` : ""),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 30),
  keepAliveIntervalMs: Number(process.env.KEEP_ALIVE_INTERVAL_MS ?? 5 * 60 * 1000),
};

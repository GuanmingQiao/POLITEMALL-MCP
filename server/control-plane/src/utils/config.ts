// LOCAL_MODE=1 runs the very same server (same tools, same routes) on your own machine with no
// AWS: the master key lives in a file next to the token store and the public origin defaults to
// localhost. Everything else behaves identically to the hosted deployment.
const local = process.env.LOCAL_MODE === "1";
const port = Number(process.env.PORT ?? 3000);

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

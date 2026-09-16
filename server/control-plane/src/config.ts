export const config = {
  port: Number(process.env.PORT ?? 3000),
  awsRegion: process.env.AWS_REGION ?? "ap-southeast-1",
  masterKeySecretId: process.env.MASTER_KEY_SECRET_ID ?? "politemall-mcp/master-key",
  storeFile: process.env.STORE_FILE ?? "/data/tokens.json",
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "",
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 30),
};

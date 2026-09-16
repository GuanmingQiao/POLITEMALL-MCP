export const config = {
  port: Number(process.env.PORT ?? 3000),
  awsRegion: process.env.AWS_REGION ?? "ap-southeast-1",
  masterKeySecretId: process.env.MASTER_KEY_SECRET_ID ?? "politemall-mcp/master-key",
  usersFile: process.env.USERS_FILE ?? "/data/users.json",
  storeFile: process.env.STORE_FILE ?? "/data/sessions.json",
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "",
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 30),
};

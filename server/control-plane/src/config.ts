export const config = {
  port: Number(process.env.PORT ?? 3000),
  awsRegion: process.env.AWS_REGION ?? "ap-southeast-1",
  masterKeySecretId: process.env.MASTER_KEY_SECRET_ID ?? "politemall-mcp/master-key",
  usersFile: process.env.USERS_FILE ?? "/data/users.json",
  storeFile: process.env.STORE_FILE ?? "/data/sessions.json",
  loginSessionImage: process.env.LOGIN_SESSION_IMAGE ?? "politemall-mcp-login-session:latest",
  dockerNetwork: process.env.DOCKER_NETWORK ?? "politemall-net",
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "",
  controlPlaneInternalUrl: process.env.CONTROL_PLANE_INTERNAL_URL ?? "http://control-plane:3000",
  loginSessionTimeoutMs: 6 * 60 * 1000,
};

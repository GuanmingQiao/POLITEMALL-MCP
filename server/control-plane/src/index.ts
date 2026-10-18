import { config } from "./utils/config.js";
import { loadMasterKey } from "./auth/secrets.js";
import { buildApp } from "./app.js";
import { warmD2lVersions } from "./api/d2l-versions.js";
import { SCHOOL_HOSTS } from "./api/d2l-client.js";
import { configureD2lSession } from "./auth/d2l-session.js";
import { silentRelogin } from "./auth/signin-browser.js";
import { attachSigninSockets } from "./auth/signin-stream.js";
import { startKeepAlive } from "./auth/keep-alive.js";

await loadMasterKey();
// Resolve each D2L tenant's latest LE/LP API version up front so problems show in the boot log.
// Not fatal: versions are discovered lazily too, so a tenant that is briefly unreachable now is
// simply retried on first use.
await warmD2lVersions(Object.values(SCHOOL_HOSTS));

// When a person's D2L session can no longer mint a token, renew it from their saved Microsoft
// sign-in state in a background browser before asking them to sign in again.
configureD2lSession({ silentRelogin });

const server = buildApp().listen(config.port, () => {
  console.log(`politemall-mcp control-plane listening on :${config.port}`);
});
attachSigninSockets(server);

// Renew every stored D2L session hourly so idle ones do not expire between uses.
startKeepAlive();

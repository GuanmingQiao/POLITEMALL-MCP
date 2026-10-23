import type { ToolContext } from "../types/tool-context.js";
import type { D2LSchool } from "../types/schools.js";
import { connectedSchools } from "../auth/session-vault.js";
import { getD2lAuth, invalidateD2lAuth, recoverD2lAuth } from "../auth/d2l-session.js";
import { LOCAL_USER_ID, lastSigninFailure, signinInProgress, startLocalSignin } from "./signin.js";

// The local server's ToolContext: always the one person on this computer, with the same vault,
// renewal and recovery functions the hosted context uses. The only difference is how it tells a
// person to sign in: it opens the sign-in window itself and says so.
export function createLocalContext(start: () => unknown = () => void startLocalSignin()): ToolContext {
  return {
    connectedSchools: () => connectedSchools(LOCAL_USER_ID),
    getD2lAuth: (school) => getD2lAuth(LOCAL_USER_ID, school as D2LSchool),
    invalidateD2lAuth: (school) => invalidateD2lAuth(LOCAL_USER_ID, school as D2LSchool),
    recoverD2lAuth: (school, rejectedAuth) => recoverD2lAuth(LOCAL_USER_ID, school as D2LSchool, rejectedAuth),
    connectUrl: () => "the sign-in window on this computer",
    connectHint: () => {
      const failed = lastSigninFailure();
      if (failed?.noBrowser) return `${failed.reason} Then ask again.`;
      if (!signinInProgress()) start();
      return "A sign-in window has opened on this computer. Finish signing in there (you type your own Microsoft credentials), then ask again.";
    },
  };
}

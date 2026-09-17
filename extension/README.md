# POLITEMall MCP — cookie sync extension

Replaces the DevTools copy-paste step on `/connect` with one click. Reads your
session cookies (via the browser's own extension cookie API — the only thing
that can see `httpOnly` cookies at all, which is why this needs an extension and
not just a bookmarklet) and posts them straight to `/sync`.

Login itself is unchanged: you still have to be on the corporate network and log
in to `lms.polite.edu.sg` / `nyplms.polite.edu.sg` / `stms.polite.edu.sg` normally
in a regular tab first. This just automates the "copy the cookie out and paste it
into the form" part that follows.

## Install (no admin rights required)

1. Download/clone this repo, or just the `extension/` folder.
2. Open `chrome://extensions` (or `edge://extensions` in Edge).
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked**, and select the `extension/` folder.

If your organization's policy blocks Developer Mode / unpacked extensions, this
won't work — fall back to the `/connect` page's manual DevTools flow instead.

## Use

1. Click the extension icon.
2. Paste your token once (or click **Generate a new token** to get one — same as
   `/connect`'s first step). It's saved locally in the extension, not synced
   anywhere.
3. Click **Sync all connected schools** (or an individual school button) any time
   your session expires. No DevTools, no copy-paste.

The server URL field defaults to the hosted server; change it if you're pointing
at a different deployment.

## What it can and can't do

- It cannot log you in — POLITE's SSO only works from the corporate network in a
  real browser tab, so that part is unavoidable no matter what.
- It cannot silently keep syncing in the background — you still click it after
  a cookie expires. Combined with the server's keep-alive ping, this should mean
  clicking it rarely rather than never.
- Your token is stored in this extension's local storage (`chrome.storage.local`)
  on this machine only, same trust level as a saved password in your browser.
- **On some corporate networks**, a security/remote-browser-isolation proxy
  intercepts direct API calls made from the extension's own context and returns
  its own HTML instead of the real response — `/signup` in particular, since it's
  the one call that returns a fresh secret. If **Generate a new token** shows a
  garbled non-JSON response instead of a token, that's what's happening; fall
  back to generating one manually on `/connect` in a regular tab (that path isn't
  affected) and pasting it into the token field here instead. This is a network
  policy issue outside the extension's control, not a bug to chase further.

## Updating after a code change

Editing `popup.js`/`popup.html` alone takes effect next time you open the
popup — no reload needed. If `manifest.json` changes (e.g. a new permission is
added), go to `chrome://extensions` and click the reload icon on this
extension's card; Chrome will prompt you to accept the new permission.

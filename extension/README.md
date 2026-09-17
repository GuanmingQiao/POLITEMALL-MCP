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
2. Already have a token? Paste it straight into the token field — done, skip to
   step 3. First time? Click **Generate a new token**: this opens `/connect` in a
   new tab (clearly labeled as opened by the extension) — click its **Generate a
   new token** button there, and the result is saved back into the extension
   automatically. Reopen the popup afterward to see it filled in.
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
- On some corporate networks, a security proxy intercepts and rewrites requests
  made directly from the extension's own context (fetch or injected script,
  didn't matter which) — a real click on `/connect`'s own button was the only
  thing confirmed to reliably get through. That's why generating a token opens a
  real tab and needs one manual click there instead of the popup calling the API
  itself: `connectWatcher.js`, a content script scoped only to `/connect`, watches
  that page's DOM for the resulting token and saves it into the extension's
  storage, so there's still no copy-paste involved. Sync calls a plain `fetch()`
  directly from the popup, since that path was confirmed working as-is.

## Updating after a code change

Editing `popup.js`/`popup.html`/`connectWatcher.js` alone takes effect next time
you open the popup or reload `/connect` — no extension reload needed. If
`manifest.json` changes (e.g. a new permission or content script is added), go
to `chrome://extensions` and click the reload icon on this extension's card;
Chrome will prompt you to accept any new permission.

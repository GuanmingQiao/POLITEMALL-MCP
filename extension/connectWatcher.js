// Content script for /connect only. Extension-triggered fetch() calls to the
// API get intercepted by a corporate security proxy on some networks (see
// popup.js), but a real click on this page's own "Generate a new token"
// button goes through fine — that's just a normal page, no extension
// involved in the network request at all. So instead of calling /signup
// ourselves, the extension opens this page and waits for you to click it
// yourself; this script just watches the DOM for the resulting token and
// saves it straight into the extension's storage, so there's no manual
// copy-paste back into the popup afterward.
const tokenValueEl = document.getElementById("tokenValue");
if (tokenValueEl) {
  const observer = new MutationObserver(() => {
    const token = tokenValueEl.textContent.trim();
    if (token) {
      chrome.storage.local.set({ token });
      observer.disconnect();
    }
  });
  observer.observe(tokenValueEl, { childList: true, characterData: true, subtree: true });
}

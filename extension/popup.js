const DOMAINS = {
  politemall: "lms.polite.edu.sg",
  nyp: "nyplms.polite.edu.sg",
  step: "stms.polite.edu.sg",
};

const serverUrlInput = document.getElementById("serverUrl");
const tokenInput = document.getElementById("token");
const statusEl = document.getElementById("status");

chrome.storage.local.get(["serverUrl", "token"]).then(({ serverUrl, token }) => {
  if (serverUrl) serverUrlInput.value = serverUrl;
  if (token) tokenInput.value = token;
});
serverUrlInput.addEventListener("change", () =>
  chrome.storage.local.set({ serverUrl: serverUrlInput.value.trim().replace(/\/$/, "") })
);
tokenInput.addEventListener("change", () => chrome.storage.local.set({ token: tokenInput.value.trim() }));

// If connectWatcher.js (running on the /connect tab we open below) picks up a
// freshly generated token while this popup isn't open to receive it directly,
// it saves straight to storage — reflect that here if it changes underneath us.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token) {
    tokenInput.value = changes.token.newValue ?? "";
  }
});

function setStatus(text) {
  statusEl.textContent = text;
}

// The cookies we need (d2lSessionVal etc.) are httpOnly, so this is the one part
// of the flow that genuinely requires the browser's own privileged cookies API —
// no page script (bookmarklet or otherwise) could read these.
async function cookieHeaderFor(domain) {
  const cookies = await chrome.cookies.getAll({ domain });
  if (cookies.length === 0) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function syncOne(school) {
  const serverUrl = serverUrlInput.value.trim().replace(/\/$/, "");
  const token = tokenInput.value.trim();
  if (!serverUrl || !token) return `${school}: set server URL + token first`;

  const cookieHeader = await cookieHeaderFor(DOMAINS[school]);
  if (!cookieHeader) return `${school}: no cookies found — log in there in a normal tab first`;

  try {
    const res = await fetch(`${serverUrl}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ school, cookieHeader }),
    });
    return res.ok ? `${school}: synced` : `${school}: failed (HTTP ${res.status})`;
  } catch (e) {
    return `${school}: request failed — ${e.message}`;
  }
}

document.getElementById("syncPolitemall").addEventListener("click", async () => setStatus(await syncOne("politemall")));
document.getElementById("syncNyp").addEventListener("click", async () => setStatus(await syncOne("nyp")));
document.getElementById("syncStep").addEventListener("click", async () => setStatus(await syncOne("step")));

document.getElementById("syncAll").addEventListener("click", async () => {
  setStatus("Syncing…");
  const results = [];
  for (const school of Object.keys(DOMAINS)) {
    results.push(await syncOne(school));
  }
  setStatus(results.join("\n"));
});

// A direct fetch('/signup') from the extension's own context gets intercepted
// and rewritten by a corporate web-isolation proxy on some networks (returns
// an HTML wrapper instead of real JSON) — confirmed true even when the fetch
// is run inside an injected content script in a real tab. The one thing
// that's actually reliable is a genuine human click on /connect's own button
// in a normally-opened tab. So instead of calling the API ourselves, open
// that page (flagged with ?ext=1 so it explains itself) and let
// connectWatcher.js pick up the resulting token into storage automatically —
// no copy-paste needed, just one extra click on the opened tab.
document.getElementById("generateToken").addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.trim().replace(/\/$/, "");
  if (!serverUrl) {
    setStatus("Set the server URL first.");
    return;
  }
  await chrome.tabs.create({ url: `${serverUrl}/connect?ext=1` });
  setStatus(
    "Opened a new tab — click \"Generate a new token\" there. Some networks block this extension from calling the API directly, so a real click on that page is needed; the resulting token will be saved back into this extension automatically. Reopen this popup afterward to see it filled in."
  );
});

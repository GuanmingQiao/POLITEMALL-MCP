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

document.getElementById("generateToken").addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.trim().replace(/\/$/, "");
  if (!serverUrl) {
    setStatus("Set the server URL first.");
    return;
  }
  try {
    const res = await fetch(`${serverUrl}/signup`, { method: "POST" });
    const data = await res.json();
    tokenInput.value = data.token;
    await chrome.storage.local.set({ token: data.token, serverUrl });
    setStatus("New token generated and saved in this extension.\nIf you use it elsewhere (MCP client config), copy it now — it won't be shown again.");
  } catch (e) {
    setStatus("Failed to generate token: " + e.message);
  }
});

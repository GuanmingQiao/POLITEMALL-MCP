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

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// A direct fetch() from the extension's own context (chrome-extension://...)
// gets intercepted and rewritten by a corporate web-isolation proxy on some
// networks, returning an HTML wrapper instead of the real API response — even
// though host_permissions lets the browser read it without a CORS error. The
// one thing confirmed to get through reliably is a same-origin fetch made
// from inside a normally-navigated tab at our own server (exactly what
// /connect's own buttons do). So route every API call through a background
// tab there instead of calling fetch() here directly.
async function callViaConnectTab(serverUrl, path, options) {
  const tab = await chrome.tabs.create({ url: `${serverUrl}/connect`, active: false });
  try {
    await waitForTabLoad(tab.id);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (path, options) => {
        try {
          const res = await fetch(path, options);
          const text = await res.text();
          return { ok: res.ok, status: res.status, text };
        } catch (e) {
          return { ok: false, status: 0, text: "", error: e.message };
        }
      },
      args: [path, options],
    });
    return result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function syncOne(school) {
  const serverUrl = serverUrlInput.value.trim().replace(/\/$/, "");
  const token = tokenInput.value.trim();
  if (!serverUrl || !token) return `${school}: set server URL + token first`;

  const cookieHeader = await cookieHeaderFor(DOMAINS[school]);
  if (!cookieHeader) return `${school}: no cookies found — log in there in a normal tab first`;

  try {
    const result = await callViaConnectTab(serverUrl, "/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ school, cookieHeader }),
    });
    if (result.error) return `${school}: request failed — ${result.error}`;
    return result.ok ? `${school}: synced` : `${school}: failed (HTTP ${result.status})`;
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
    const result = await callViaConnectTab(serverUrl, "/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (result.error) {
      setStatus("Failed to generate token: " + result.error);
      return;
    }
    let data;
    try {
      data = JSON.parse(result.text);
    } catch {
      setStatus(`Unexpected response from ${serverUrl}/signup (HTTP ${result.status}):\n${result.text.slice(0, 300)}`);
      return;
    }
    if (!result.ok || !data.token) {
      setStatus(`Signup failed (HTTP ${result.status}): ${result.text.slice(0, 300)}`);
      return;
    }
    tokenInput.value = data.token;
    await chrome.storage.local.set({ token: data.token, serverUrl });
    setStatus("New token generated and saved in this extension.\nIf you use it elsewhere (MCP client config), copy it now — it won't be shown again.");
  } catch (e) {
    setStatus("Failed to generate token: " + e.message);
  }
});

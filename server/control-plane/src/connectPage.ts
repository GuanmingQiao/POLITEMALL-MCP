export function renderConnectPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Connect POLITEMall MCP</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #222; }
  h1 { font-size: 1.3rem; }
  h2 { font-size: 1.05rem; margin-top: 2em; }
  ol { padding-left: 1.2em; }
  li { margin-bottom: 0.6em; }
  code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; }
  label { display: block; margin-top: 16px; font-weight: 600; }
  input { width: 100%; box-sizing: border-box; padding: 8px; margin-top: 4px; font-family: monospace; }
  button { margin-top: 16px; padding: 8px 20px; font-size: 1rem; }
  #status, #tokenBox { margin-top: 16px; padding: 10px; border-radius: 4px; display: none; }
  #status.ok, #tokenBox { display: none; background: #e6f4ea; color: #1e7e34; }
  #status.err { display: block; background: #fdecea; color: #a12622; }
  #tokenBox.show { display: block; }
  #tokenValue { font-family: monospace; font-weight: bold; word-break: break-all; }
</style>
</head>
<body>
<h1>Connect to POLITEMall MCP</h1>

<p><strong>Cookie expired and you already have a token?</strong> You don't need a new
one and you don't need to touch your MCP client's config — just skip to the form
below, enter your existing token and a fresh cookie, and submit. The token is what
your MCP client is connected to; only the cookie behind it changes.</p>

<h2>First time here? Get a token</h2>
<p>Tokens aren't tied to your name or account here — it's just a random key that maps
to your connected session. If you lose it, generate a new one; there's no recovery,
but you'll need to update your MCP client's config with the new one.</p>
<button id="generate">Generate a new token</button>
<div id="tokenBox">
  <div id="tokenValue"></div>
  <p><strong>Save this now — it will not be shown again.</strong> Put it straight into
  your MCP client's config, or a password manager. Don't paste it anywhere else.</p>
</div>

<h2>Connect (or refresh) your POLITEMall session</h2>
<p>POLITEMall's login only works from the polytechnic corporate network/VPN, so this
has to happen in your own regular browser, not on this page.</p>
<ol>
  <li>In a normal browser tab, log in at <a href="https://lms.polite.edu.sg/d2l/home" target="_blank">lms.polite.edu.sg</a> as you usually do.</li>
  <li>Open DevTools (<code>F12</code>) → <strong>Network</strong> tab, then reload the page.</li>
  <li>Click any request to <code>lms.polite.edu.sg</code>, open its <strong>Request Headers</strong>, and copy the full value of the <code>Cookie</code> header (the whole string, e.g. <code>d2lSessionVal=...; d2lSecureSessionVal=...</code>).</li>
  <li>Paste it below along with your token (new or existing), then submit.</li>
</ol>
<p><strong>Treat both values like passwords</strong> — don't paste them anywhere else. This page sends them directly and only to this server over HTTPS.</p>

<label for="token">Your token</label>
<input id="token" type="password" autocomplete="off" placeholder="new from above, or your existing one">

<label for="cookie">Cookie header from lms.polite.edu.sg</label>
<input id="cookie" type="password" autocomplete="off" placeholder="d2lSessionVal=...; d2lSecureSessionVal=...">

<button id="submit">Connect</button>
<div id="status"></div>

<script>
document.getElementById('generate').addEventListener('click', async () => {
  const res = await fetch('/signup', { method: 'POST' });
  const data = await res.json();
  document.getElementById('tokenValue').textContent = data.token;
  document.getElementById('tokenBox').className = 'show';
  document.getElementById('token').value = data.token;
});

document.getElementById('submit').addEventListener('click', async () => {
  const token = document.getElementById('token').value.trim();
  const cookieHeader = document.getElementById('cookie').value.trim();
  const status = document.getElementById('status');
  status.className = '';
  status.style.display = 'none';
  if (!token || !cookieHeader) {
    status.textContent = 'Both fields are required.';
    status.className = 'err';
    return;
  }
  try {
    const res = await fetch('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ cookieHeader }),
    });
    if (res.ok) {
      status.textContent = 'Connected! You can close this tab.';
      status.className = 'ok';
      status.style.display = 'block';
      document.getElementById('cookie').value = '';
    } else {
      status.textContent = 'Failed (' + res.status + '). Check your token and try again.';
      status.className = 'err';
    }
  } catch (e) {
    status.textContent = 'Request failed: ' + e.message;
    status.className = 'err';
  }
});
</script>
</body>
</html>`;
}

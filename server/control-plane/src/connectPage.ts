export function renderConnectPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Connect POLITEMall MCP</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #222; }
  h1 { font-size: 1.3rem; }
  ol { padding-left: 1.2em; }
  li { margin-bottom: 0.6em; }
  code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; }
  label { display: block; margin-top: 16px; font-weight: 600; }
  input { width: 100%; box-sizing: border-box; padding: 8px; margin-top: 4px; font-family: monospace; }
  button { margin-top: 16px; padding: 8px 20px; font-size: 1rem; }
  #status { margin-top: 16px; padding: 10px; border-radius: 4px; display: none; }
  #status.ok { display: block; background: #e6f4ea; color: #1e7e34; }
  #status.err { display: block; background: #fdecea; color: #a12622; }
</style>
</head>
<body>
<h1>Connect your POLITEMall account</h1>
<p>You must be on the polytechnic corporate network (or VPN) to log in to POLITEMall — this only works from your own regular browser, not from this page directly.</p>
<ol>
  <li>In a normal browser tab, log in at <a href="https://lms.polite.edu.sg/d2l/home" target="_blank">lms.polite.edu.sg</a> as you usually do.</li>
  <li>Open DevTools (<code>F12</code>) → <strong>Network</strong> tab, then reload the page.</li>
  <li>Click any request to <code>lms.polite.edu.sg</code>, open its <strong>Request Headers</strong>, and copy the full value of the <code>Cookie</code> header (the whole string, e.g. <code>d2lSessionVal=...; d2lSecureSessionVal=...</code>).</li>
  <li>Paste it below along with your personal access token, then submit.</li>
</ol>
<p><strong>Treat both values like passwords</strong> — don't paste them anywhere else. This page sends them directly and only to this server over HTTPS.</p>

<label for="token">Your access token</label>
<input id="token" type="password" autocomplete="off" placeholder="the token you were given">

<label for="cookie">Cookie header from lms.polite.edu.sg</label>
<input id="cookie" type="password" autocomplete="off" placeholder="d2lSessionVal=...; d2lSecureSessionVal=...">

<button id="submit">Connect</button>
<div id="status"></div>

<script>
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
      document.getElementById('token').value = '';
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

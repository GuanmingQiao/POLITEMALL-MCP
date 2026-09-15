export function renderLoginPage(sessionId: string, userName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>POLITEMall login — ${userName}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { padding: 12px 16px; background: #1a1a1a; border-bottom: 1px solid #333; }
  #status { padding: 10px 16px; background: #223; font-size: 14px; }
  #status.complete { background: #164016; }
  iframe { width: 100%; height: calc(100vh - 90px); border: none; display: block; }
</style>
</head>
<body>
<header><strong>POLITEMall login</strong> — signed in as ${userName} on the MCP server. Log in through the embedded browser below with your normal SSO.</header>
<div id="status">Waiting for you to complete login…</div>
<iframe src="/vnc/${sessionId}/vnc.html?autoconnect=true&resize=remote&show_dot=true"></iframe>
<script>
const el = document.getElementById('status');
const poll = setInterval(async () => {
  const res = await fetch('/login/status?sessionId=${sessionId}');
  const data = await res.json();
  if (data.status === 'complete') {
    el.textContent = 'Login captured! You can close this tab.';
    el.classList.add('complete');
    clearInterval(poll);
  }
}, 2000);
</script>
</body>
</html>`;
}

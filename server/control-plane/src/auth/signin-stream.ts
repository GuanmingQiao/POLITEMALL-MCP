import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "../utils/config.js";
import { getOpenSignin, getSignin } from "./signin-registry.js";
import { SigninSession, type SigninDeps } from "./signin-session.js";
import { VIEWPORT } from "./signin-browser.js";

// The two entry points of a streamed sign-in: the page the person opens (GET /signin/:id) and the
// WebSocket that carries screencast frames out and pointer/keyboard events in
// (/signin/:id/ws). The id in the link is the only credential; it works for one sign-in and stops
// working when that finishes, fails or expires. Nothing the person types passes through anything
// but the browser, and nothing is logged.

const WS_PATH = /^\/signin\/([A-Za-z0-9_-]{16,64})\/ws$/;

function pageHtml(id: string, nonce: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<style nonce="${nonce}">
:root{--bg:#f6f7f9;--fg:#1c2330;--muted:#5b6575;--card:#fff;--line:#d7dce3;--accent:#1d5fd1}
@media (prefers-color-scheme:dark){:root{--bg:#12161c;--fg:#e6e9ee;--muted:#98a2b3;--card:#1a2029;--line:#2c3541;--accent:#6aa0ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:1060px;margin:0 auto;padding:16px}h1{font-size:1.2rem;margin:.2rem 0 .4rem}
p{color:var(--muted);margin:.2rem 0 .8rem}#status{color:var(--fg);min-height:1.5em}
.frame{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px}
canvas{width:100%;height:auto;display:block;border-radius:6px;background:#fff;touch-action:none;outline:none}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
button,input{font:inherit;padding:8px 12px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px}
button{cursor:pointer}button:hover{border-color:var(--accent)}input{flex:1;min-width:180px}
</style></head><body><main>
<h1>Sign in to POLITEMall</h1>
<p>You are typing into a secure browser running on the server. Your password and codes go only to Microsoft's sign-in page and are never stored or logged. This page closes itself when you are signed in.</p>
<p id="status" role="status">Connecting…</p>
<div class="frame"><canvas id="screen" width="${VIEWPORT.width}" height="${VIEWPORT.height}" tabindex="0"></canvas></div>
<div class="row">
<input id="phone" type="text" placeholder="On a phone: tap here to type, then press Send" autocomplete="off" autocapitalize="off" spellcheck="false">
<button id="send" type="button">Send</button>
<button id="pm" type="button">Open POLITEMall</button>
<button id="nyp" type="button">Open NYP</button>
</div></main>
<script nonce="${nonce}">
(()=>{
const W=${VIEWPORT.width},H=${VIEWPORT.height};
const c=document.getElementById('screen'),g=c.getContext('2d'),st=document.getElementById('status');
const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/signin/${id}/ws');
ws.binaryType='arraybuffer';let ended=false;
const send=o=>{if(ws.readyState===1&&!ended)ws.send(JSON.stringify(o))};
ws.onmessage=async e=>{
  if(typeof e.data!=='string'){try{const b=await createImageBitmap(new Blob([e.data],{type:'image/jpeg'}));g.drawImage(b,0,0,W,H);b.close&&b.close()}catch{}return}
  const m=JSON.parse(e.data);
  if(m.type==='status')st.textContent=m.message;
  if(m.type==='done'){ended=true;st.textContent='Signed in. You can close this tab.';if(m.redirect)location.replace(m.redirect)}
  if(m.type==='fail'){ended=true;st.textContent=m.reason}
};
ws.onclose=()=>{if(!ended)st.textContent='The connection closed. Ask for a new sign-in link.'};
const pt=e=>{const r=c.getBoundingClientRect();return{x:Math.round((e.clientX-r.left)*W/r.width),y:Math.round((e.clientY-r.top)*H/r.height)}};
c.addEventListener('pointerdown',e=>{c.focus();send({t:'mouse',type:'down',button:e.button,...pt(e)})});
c.addEventListener('pointerup',e=>send({t:'mouse',type:'up',button:e.button,...pt(e)}));
c.addEventListener('pointermove',e=>{if(e.buttons)send({t:'mouse',type:'move',...pt(e)})});
c.addEventListener('wheel',e=>{e.preventDefault();send({t:'mouse',type:'wheel',dx:e.deltaX,dy:e.deltaY,...pt(e)})},{passive:false});
c.addEventListener('keydown',e=>{if(e.key==='Dead'||e.isComposing)return;e.preventDefault();send({t:'key',key:e.key,shift:e.shiftKey,ctrl:e.ctrlKey,alt:e.altKey,meta:e.metaKey})});
document.getElementById('send').onclick=()=>{const i=document.getElementById('phone');if(i.value){send({t:'text',text:i.value});i.value=''}};
document.getElementById('pm').onclick=()=>send({t:'open',school:'politemall'});
document.getElementById('nyp').onclick=()=>send({t:'open',school:'nyp'});
})();
</script></body></html>`;
}

// GET /signin/:id
export function signinPage(req: Request, res: Response): void {
  const id = String(req.params.id ?? "");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!getOpenSignin(id)) {
    res.status(410).type("text/plain").send("This sign-in link has already been used or has expired. Ask your assistant for a new one.");
    return;
  }
  const nonce = randomBytes(16).toString("base64");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  );
  res.type("html").send(pageHtml(id, nonce));
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const allowed = new URL(config.publicOrigin || `http://${req.headers.host}`);
    return new URL(origin).host === allowed.host;
  } catch {
    return false;
  }
}

// Wires the sign-in WebSocket into the HTTP server. `deps` lets tests replace Chromium.
export function attachSigninSockets(server: Server, deps?: SigninDeps): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const match = WS_PATH.exec((req.url ?? "").split("?")[0]);
    if (!match) return; // not ours; another handler (or none) deals with it
    const signin = getOpenSignin(match[1]);
    if (!signin || !sameOrigin(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => serve(ws, match[1], deps));
  });
}

function serve(ws: WebSocket, id: string, deps?: SigninDeps): void {
  const signin = getOpenSignin(id);
  if (!signin) {
    ws.close();
    return;
  }
  const send = (o: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));
  const session = new SigninSession(
    signin,
    {
      frame: (jpeg) => ws.readyState === ws.OPEN && ws.send(jpeg, { binary: true }),
      status: (message) => send({ type: "status", message }),
      done: (redirect) => {
        send({ type: "done", redirect });
        ws.close();
      },
      fail: (reason) => {
        send({ type: "fail", reason });
        ws.close();
      },
    },
    deps
  );

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const m = msg as { t?: string; school?: unknown };
    if (m.t === "open") void session.openSchool(m.school);
    else void session.input(msg);
  });
  // The viewer went away before the sign-in finished: end the browser and discard what it holds.
  ws.on("close", () => {
    if (getSignin(id)?.state === "running") void session.stop();
  });
  void session.run();
}

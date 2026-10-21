import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "../utils/config.js";
import { auditLog } from "../utils/audit-log.js";
import { checkSignin, getSignin, type LinkRefusal, type PendingSignin, type SigninOutcome } from "./signin-registry.js";
import { SigninSession, type SigninDeps, type SigninIo } from "./signin-session.js";
import { VIEWPORT } from "./signin-browser.js";
import { clientIp } from "./rate-limit.js";
import { checkStart, clearStrikes, recordStrike, refusalMessage, resetStartLimitsForTests } from "./start-limits.js";

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
<p>You are typing into a secure browser running on the server. Your password and codes go only to Microsoft's sign-in page and are never stored or logged. If Microsoft offers a passkey or security key, choose another way to sign in (password or the Authenticator app). If Microsoft asks "Stay signed in?", it is answered Yes for you so you rarely need to sign in again. You can switch to your Authenticator app and come back; this page reconnects and closes itself when you are signed in.</p>
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
let ws=null,ended=false,tries=0,timer=null;
const send=o=>{if(ws&&ws.readyState===1&&!ended)ws.send(JSON.stringify(o))};
function connect(){
  if(ended)return;
  clearTimeout(timer);
  ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/signin/${id}/ws');
  ws.binaryType='arraybuffer';
  ws.onopen=()=>{tries=0};
  ws.onmessage=async e=>{
    if(typeof e.data!=='string'){try{const b=await createImageBitmap(new Blob([e.data],{type:'image/jpeg'}));g.drawImage(b,0,0,W,H);b.close&&b.close()}catch{}return}
    const m=JSON.parse(e.data);
    if(m.type==='status')st.textContent=m.message;
    if(m.type==='done'){ended=true;st.textContent='Signed in. You can close this tab.'+(m.notice?' '+m.notice:'');if(m.redirect)setTimeout(()=>location.replace(m.redirect),m.notice?5000:0)}
    if(m.type==='fail'){ended=true;st.textContent=m.reason}
  };
  ws.onclose=()=>{
    if(ended)return;
    if(++tries>60){ended=true;st.textContent='The connection closed. Ask for a new sign-in link.';return}
    st.textContent='Reconnecting\\u2026';
    timer=setTimeout(connect,tries<3?500:2000);
  };
}
connect();
document.addEventListener('visibilitychange',()=>{if(!ended&&document.visibilityState==='visible'&&(!ws||ws.readyState>1))connect()});
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

const REFUSAL_TEXT: Record<LinkRefusal, string> = {
  expired: "This sign-in link has expired. Ask your assistant for a new one.",
  finished: "This sign-in link has already been used, or its sign-in has ended. Ask your assistant for a new one.",
  unknown: "This sign-in link is not recognised. The server may have restarted since it was issued. Ask your assistant for a new one.",
};

// GET /signin/:id
export function signinPage(req: Request, res: Response): void {
  const id = String(req.params.id ?? "");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const checked = checkSignin(id);
  if ("refused" in checked) {
    auditLog("signin_link_refused", { reason: checked.refused, where: "page" });
    res.status(410).type("text/plain").send(REFUSAL_TEXT[checked.refused]);
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

// One running sign-in and whoever is currently watching it. The browser outlives a viewer's
// connection for a grace period so a person can switch apps (to approve a push) and come back.
interface Live {
  session: SigninSession;
  ws?: WebSocket;
  lastStatus?: string;
  // The client IP that started this sign-in, for the start budget and strikes.
  ip: string;
  grace?: NodeJS.Timeout;
}
const lives = new Map<string, Live>();

const attached = (live: Live): WebSocket | undefined => (live.ws && live.ws.readyState === live.ws.OPEN ? live.ws : undefined);

function deliver(signin: PendingSignin, ws: WebSocket): void {
  if (!signin.outcome) return;
  ws.send(JSON.stringify(signin.outcome));
  signin.outcomeDelivered = true;
  ws.close();
}

// The sign-in ended. Tell the viewer if there is one; otherwise the outcome waits for the next.
function finish(signin: PendingSignin, live: Live, outcome: SigninOutcome): void {
  signin.outcome = outcome;
  clearTimeout(live.grace);
  const ws = attached(live);
  if (ws) deliver(signin, ws);
}

function viewerIo(signin: PendingSignin, live: Live): SigninIo {
  return {
    frame: (jpeg) => void attached(live)?.send(jpeg, { binary: true }),
    status: (message) => {
      live.lastStatus = message;
      attached(live)?.send(JSON.stringify({ type: "status", message }));
    },
    done: (redirect, notice) => finish(signin, live, { type: "done", redirect, notice }),
    fail: (reason) => finish(signin, live, { type: "fail", reason }),
  };
}

// Used while nobody is watching: frames are dropped, the latest status is remembered, and an
// outcome is held for the viewer who comes back.
function holderIo(signin: PendingSignin, live: Live): SigninIo {
  return {
    frame: () => undefined,
    status: (message) => {
      live.lastStatus = message;
    },
    done: (redirect, notice) => finish(signin, live, { type: "done", redirect, notice }),
    fail: (reason) => finish(signin, live, { type: "fail", reason }),
  };
}

// Wires the sign-in WebSocket into the HTTP server. `deps` lets tests replace Chromium.
export function attachSigninSockets(server: Server, deps?: SigninDeps): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const match = WS_PATH.exec((req.url ?? "").split("?")[0]);
    if (!match) return; // not ours; another handler (or none) deals with it
    const checked = checkSignin(match[1]);
    const live = lives.get(match[1]);
    const refuse = (reason?: string) => {
      if (reason) auditLog("signin_link_refused", { reason, where: "socket" });
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
    };
    if ("refused" in checked) return refuse(checked.refused);
    if (!sameOrigin(req)) return refuse();
    // One viewer at a time: a second connection must not take over a sign-in someone is watching.
    if (live && attached(live)) return refuse("in_use");
    const ip = clientIp(req);
    // Starting a browser is what costs; reattaching to a running one is not a start.
    const starting = !live && "signin" in checked && checked.signin.state === "open" ? checkStart(ip) : undefined;
    if (starting) {
      auditLog("signin_rate_limited", { kind: starting.kind });
      // Accept the socket and say why, so the page shows it and does not keep reconnecting.
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(JSON.stringify({ type: "fail", reason: refusalMessage(starting) }));
        ws.close();
      });
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => serve(ws, match[1], ip, deps));
  });
}

function serve(ws: WebSocket, id: string, ip: string, deps?: SigninDeps): void {
  const signin = getSignin(id);
  if (!signin) {
    ws.close();
    return;
  }
  // The sign-in ended while nobody was watching: this viewer is told how, once.
  if (signin.outcome && !signin.outcomeDelivered) {
    deliver(signin, ws);
    return;
  }

  let live = lives.get(id);
  if (live) {
    clearTimeout(live.grace);
    live.ws = ws;
    if (live.lastStatus) ws.send(JSON.stringify({ type: "status", message: live.lastStatus }));
    void live.session.attach(viewerIo(signin, live));
  } else if (signin.state === "open") {
    const created: Live = { ip, ws, session: undefined as unknown as SigninSession };
    created.session = new SigninSession(signin, viewerIo(signin, created), deps);
    lives.set(id, created);
    live = created;
    void created.session.run().finally(() => {
      if (created.session.endReason === "done") clearStrikes(created.ip);
      else if (created.session.endReason === "timeout" || created.session.endReason === "no_input") recordStrike(created.ip);
      if (signin.state !== "running") {
        clearTimeout(created.grace);
        lives.delete(id);
      }
    });
  } else {
    ws.close();
    return;
  }

  const current = live;
  ws.on("message", (data, isBinary) => {
    if (isBinary || current.ws !== ws) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const m = msg as { t?: string; school?: unknown };
    if (m.t === "open") void current.session.openSchool(m.school);
    else void current.session.input(msg);
  });
  // The viewer went away. The browser is kept for a grace period, then closed with everything it
  // held if nobody has come back.
  ws.on("close", () => {
    if (current.ws !== ws) return;
    current.ws = undefined;
    if (signin.state !== "running") return;
    void current.session.attach(holderIo(signin, current), false);
    clearTimeout(current.grace);
    current.grace = setTimeout(() => {
      if (current.ws || signin.state !== "running") return;
      signin.failure = "viewer_left";
      auditLog("signin_failed", { reason: "viewer_left" });
      recordStrike(current.ip);
      void current.session.stop();
      lives.delete(id);
    }, config.signinReattachGraceMs);
    current.grace.unref?.();
  });
}

// Tests drop every live sign-in between cases.
export function resetSigninStreamForTests(): void {
  resetStartLimitsForTests();
  for (const live of lives.values()) clearTimeout(live.grace);
  lives.clear();
}

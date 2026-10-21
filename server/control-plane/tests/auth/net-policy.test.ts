import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRequest, isNonPublicHost } from "../../src/auth/net-policy.js";

// spec: signin-browser-hardening — the streamed browser can reach only the sign-in sites.
const SCHOOLS = ["politemall.example.edu", "nyp.example.edu"];
const nav = (url: string) => decideRequest(url, true, SCHOOLS);
const sub = (url: string) => decideRequest(url, false, SCHOOLS);

test("blocks every non-public address class for any request type", () => {
  const bad = [
    "http://127.0.0.1/", "http://127.1.2.3/", "http://10.0.0.5/", "http://172.16.0.1/", "http://172.31.255.1/",
    "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/", "http://100.127.1.1/",
    "http://224.0.0.1/", "http://0.0.0.0/", "http://255.255.255.255/",
    "http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[fc00::1]/", "http://[fd12:3456::1]/", "http://[ff02::1]/",
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:169.254.169.254]/", "http://[::ffff:7f00:1]/",
    "http://localhost/", "http://foo.localhost/", "http://metadata.internal/", "http://control-plane:3000/", "http://caddy/",
  ];
  for (const url of bad) {
    assert.equal(nav(url), "block", `${url} navigation`);
    assert.equal(sub(url), "block", `${url} subresource`);
  }
});

test("a public address just outside a private range is not treated as private", () => {
  assert.equal(isNonPublicHost("172.15.0.1"), false);
  assert.equal(isNonPublicHost("172.32.0.1"), false);
  assert.equal(isNonPublicHost("100.63.0.1"), false);
  assert.equal(isNonPublicHost("100.128.0.1"), false);
  assert.equal(isNonPublicHost("8.8.8.8"), false);
  assert.equal(isNonPublicHost("[2606:4700::1111]"), false);
});

test("blocks schemes other than http(s) and inline data", () => {
  for (const url of ["file:///etc/passwd", "ftp://example.com/", "chrome://settings", "javascript:alert(1)", "about:srcdoc", "ws://example.com/"]) {
    assert.equal(nav(url), "block", url);
  }
  assert.equal(nav("about:blank"), "allow");
  assert.equal(sub("data:text/plain,hi"), "allow");
  assert.equal(sub("blob:https://login.microsoftonline.com/abc"), "allow");
  assert.equal(nav("not a url"), "block");
});

test("allows the school hosts and Microsoft sign-in hosts", () => {
  for (const url of [
    "https://politemall.example.edu/d2l/home", "https://nyp.example.edu/d2l/lp/auth/login",
    "https://login.microsoftonline.com/common/oauth2", "https://login.live.com/", "https://aadcdn.msauth.net/x.js",
    "https://aadcdn.msftauth.net/x.js", "https://account.microsoft.com/", "https://foo.live.com/",
  ]) {
    assert.equal(nav(url), "allow", url);
    assert.equal(sub(url), "allow", url);
  }
});

test("a lookalike host is not allowed", () => {
  assert.equal(nav("https://login.microsoftonline.com.evil.example/"), "block");
  assert.equal(nav("https://evilmicrosoft.com/"), "block");
  assert.equal(nav("https://notlive.com/"), "block");
  assert.equal(nav("https://politemall.example.edu.evil.example/"), "block");
});

test("other public hosts: navigation blocked, page resources reported", () => {
  assert.equal(nav("https://evil.example/"), "block");
  assert.equal(sub("https://cdn.example.net/app.js"), "report");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { hasNewerMicrosoftState, hasPersistentMicrosoftCookie, parseBrowserState, persistentExpiry } from "../../src/auth/microsoft-state.js";

// spec: streamed-login-session - "Lapsed sessions are re-established silently where possible"

const cookie = (name: string, expires: number, domain = ".login.microsoftonline.com") => ({ name, value: "never-read", domain, path: "/", expires });
const jar = (...cookies: ReturnType<typeof cookie>[]) => ({ cookies });

test("a cookie the old jar lacked, or one that now expires later, is newer", () => {
  assert.equal(hasNewerMicrosoftState(undefined, jar(cookie("ESTSAUTH", -1))), true);
  assert.equal(hasNewerMicrosoftState(jar(cookie("ESTSAUTHPERSISTENT", 100)), jar(cookie("ESTSAUTHPERSISTENT", 200))), true);
  assert.equal(hasNewerMicrosoftState(jar(cookie("ESTSAUTH", -1)), jar(cookie("ESTSAUTH", -1), cookie("ESTSAUTHLIGHT", -1))), true);
});

test("the same or an earlier expiry, an empty jar, or other cookies are not newer", () => {
  assert.equal(hasNewerMicrosoftState(jar(cookie("ESTSAUTHPERSISTENT", 200)), jar(cookie("ESTSAUTHPERSISTENT", 200))), false);
  assert.equal(hasNewerMicrosoftState(jar(cookie("ESTSAUTHPERSISTENT", 200)), jar(cookie("ESTSAUTHPERSISTENT", 100))), false);
  assert.equal(hasNewerMicrosoftState(jar(cookie("ESTSAUTHPERSISTENT", 200)), jar()), false, "a failed run cannot replace good state with nothing");
  assert.equal(hasNewerMicrosoftState(undefined, jar(cookie("ESTSAUTH", 5, ".example.com"), cookie("other", 5))), false);
});

test("the persistent expiry is only reported for a real expiry on Microsoft's host", () => {
  assert.equal(persistentExpiry(jar(cookie("ESTSAUTHPERSISTENT", 12345))), 12345);
  assert.equal(persistentExpiry(jar(cookie("ESTSAUTHPERSISTENT", -1))), undefined, "a session cookie has no expiry to honour");
  assert.equal(persistentExpiry(jar(cookie("ESTSAUTH", 12345))), undefined);
  assert.equal(persistentExpiry(jar(cookie("ESTSAUTHPERSISTENT", 12345, ".evil.example"))), undefined);
  assert.equal(hasPersistentMicrosoftCookie(jar(cookie("ESTSAUTHPERSISTENT", 12345))), true);
  assert.equal(hasPersistentMicrosoftCookie(jar(cookie("ESTSAUTH", -1))), false);
});

test("junk input reads as no state", () => {
  assert.equal(parseBrowserState("not json"), undefined);
  assert.equal(parseBrowserState(null), undefined);
  assert.equal(hasPersistentMicrosoftCookie(parseBrowserState("{}")), false);
});

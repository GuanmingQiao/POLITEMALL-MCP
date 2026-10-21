import { test } from "node:test";
import assert from "node:assert/strict";
import { pageText } from "../../src/utils/text-page.js";

// spec: d2l-text-paging

test("text that fits is returned whole and not truncated", () => {
  assert.deepEqual(pageText("hello", 0, 10), { text: "hello", totalChars: 5, truncated: false });
});

test("long text is cut and says where to continue", () => {
  const p = pageText("abcdefghij", 0, 4);
  assert.deepEqual(p, { text: "abcd", totalChars: 10, truncated: true, nextOffset: 4 });
});

test("following nextOffset reproduces the original with no gap or overlap", () => {
  const original = "The quick brown fox ".repeat(50);
  let out = "";
  let offset = 0;
  for (;;) {
    const p = pageText(original, offset, 37);
    out += p.text;
    if (!p.truncated) {
      assert.equal(p.nextOffset, undefined);
      break;
    }
    offset = p.nextOffset!;
  }
  assert.equal(out, original);
});

test("an offset at or past the end gives empty text, not an error", () => {
  assert.deepEqual(pageText("abc", 3, 5), { text: "", totalChars: 3, truncated: false });
  assert.deepEqual(pageText("abc", 99, 5), { text: "", totalChars: 3, truncated: false });
});

test("a slice never ends inside a surrogate pair", () => {
  const text = "ab😀cd"; // the emoji is two UTF-16 units at 2..3
  const first = pageText(text, 0, 3);
  assert.equal(first.text, "ab");
  assert.equal(first.nextOffset, 2);
  assert.equal(pageText(text, 2, 3).text, "😀c");
});

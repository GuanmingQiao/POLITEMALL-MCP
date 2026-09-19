import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, mockD2l, json } from "../helpers/mcp-harness.js";
import { summarizeClasslist, isLearner } from "../../src/tools/get-classlist.js";
import type { ClasslistUser } from "../../src/types/d2l.js";

// Shaped like a real NYP classlist: RoleId is null for some staff, Email is null for everyone.
const user = (id: string, name: string, role: string, extra: Partial<ClasslistUser> = {}): ClasslistUser => ({
  Identifier: id,
  DisplayName: name,
  Username: `${name.split(",")[0].toLowerCase().trim()}@nyp.edu.sg`,
  Email: null,
  RoleId: null,
  ClasslistRoleDisplayName: role,
  ...extra,
});

const USERS: ClasslistUser[] = [
  user("5", "Lee, Ann", "Learner"),
  user("1", "Lim, Alice", "Module Leader"),
  user("4", "Tan, Bob", "Learner"),
  user("2", "Chua, Ben", "Tutor", { RoleId: 195 }),
  user("6", "Wong, Cy", "Learner"),
  user("7", "Yeo, Dee", "Learner"),
  user("8", "Zhou, Eve", "Learner"),
];
const opts = (o: Partial<Parameters<typeof summarizeClasslist>[1]> = {}) => ({ includeStudents: false, limit: 100, ...o });

test("by default only staff are listed, but the headcounts cover the whole class", () => {
  const r = summarizeClasslist(USERS, opts());
  assert.equal(r.classSize, 7);
  assert.deepEqual(r.roleCounts, { Learner: 5, "Module Leader": 1, Tutor: 1 });
  assert.equal(r.total, 2);
  assert.deepEqual(r.users.map((u) => u.role).sort(), ["Module Leader", "Tutor"]);
  assert.match(r.note!, /5 learner\(s\) are not listed; pass includeStudents=true/);
});

test("staff are recognised by role name, not by RoleId (null on NYP)", () => {
  assert.equal(isLearner(user("1", "x", "Learner")), true);
  assert.equal(isLearner(user("1", "x", "Student")), true);
  assert.equal(isLearner(user("1", "x", "Tutor", { RoleId: null })), false);
  assert.equal(isLearner(user("1", "x", "Module Leader", { RoleId: null })), false);
});

test("includeStudents lists everyone, staff first", () => {
  const r = summarizeClasslist(USERS, opts({ includeStudents: true }));
  assert.equal(r.total, 7);
  assert.deepEqual(r.users.slice(0, 2).map((u) => u.role).sort(), ["Module Leader", "Tutor"]);
  assert.equal(r.note, undefined, "nothing hidden, nothing truncated");
});

test("limit truncates, says so, and never drops staff before learners", () => {
  const r = summarizeClasslist(USERS, opts({ includeStudents: true, limit: 3 }));
  assert.equal(r.returned, 3);
  assert.equal(r.total, 7);
  assert.equal(r.truncated, true);
  assert.match(r.note!, /Showing 3 of 7/);
  assert.equal(r.users.filter((u) => u.role !== "Learner").length, 2);
});

test("searchTerm matches name or username case-insensitively, and only among the allowed roles", () => {
  assert.deepEqual(summarizeClasslist(USERS, opts({ includeStudents: true, searchTerm: "CHUA" })).users.map((u) => u.id), ["2"]);
  assert.deepEqual(summarizeClasslist(USERS, opts({ includeStudents: true, searchTerm: "wong@nyp" })).users.map((u) => u.id), ["6"]);
  // a learner isn't findable while students are hidden
  assert.equal(summarizeClasslist(USERS, opts({ searchTerm: "wong" })).total, 0);
});

test("entries are small: no email key when D2L sent none", () => {
  const r = summarizeClasslist(USERS, opts());
  assert.deepEqual(Object.keys(r.users[0]).sort(), ["id", "name", "role", "username"]);
  const withEmail = summarizeClasslist([user("9", "Ho, Fay", "Tutor", { Email: "fay@nyp.edu.sg" })], opts());
  assert.equal(withEmail.users[0].email, "fay@nyp.edu.sg");
});

test("through the MCP server: default call returns staff only and the true class size", async (t) => {
  mockD2l(t, (url) => (url.endsWith("/524042/classlist/") ? json(USERS) : undefined));
  const c = await connect(["nyp"]);
  const r = await c.call("get_classlist", { courseId: "nyp:524042" });
  assert.equal(r.isError, false);
  const body = JSON.parse(r.text);
  assert.equal(body.courseId, "nyp:524042");
  assert.equal(body.classSize, 7);
  assert.equal(body.users.length, 2);
  await c.close();
});

test("through the MCP server: limit is validated", async (t) => {
  mockD2l(t, () => undefined);
  const c = await connect(["nyp"]);
  const r = await c.call("get_classlist", { courseId: "nyp:524042", limit: 5000 });
  assert.equal(r.isError, true);
  assert.match(r.text, /limit/);
  await c.close();
});

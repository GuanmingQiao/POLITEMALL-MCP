import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionDeniedError, NotFoundError, BadRequestError, D2lHttpError } from "./d2l.js";
import { describeD2lFailure } from "./d2lErrors.js";

const route = "le/1.97/524042/grades/final/values/";
const enrolledTutor = { enrolled: true, role: "Tutor", isActive: true };
const notEnrolled = { enrolled: false, role: null, isActive: null };

test("403 for an enrolled user names their role and says it is a permission problem", () => {
  const msg = describeD2lFailure(new PermissionDeniedError("x", 403, route), { school: "nyp", courseId: "nyp:524042", access: enrolledTutor });
  assert.match(msg, /403/);
  assert.match(msg, /Your role in this course is "Tutor"/);
  assert.match(msg, /needs a permission your account doesn't have/);
  assert.match(msg, /not an expired session/);
});

test("403 includes D2L's own message and warns that some missing ids also come back as 403", () => {
  const msg = describeD2lFailure(new PermissionDeniedError("x", 403, route, "Not Authorized"), { school: "nyp", courseId: "nyp:973535", access: enrolledTutor });
  assert.match(msg, /403: "Not Authorized"/);
  assert.match(msg, /folderId/);
});

test("403/404 for a course the caller isn't enrolled in says so instead of blaming the tool", () => {
  for (const err of [new PermissionDeniedError("x", 403, route), new NotFoundError("x", 404, route)]) {
    const msg = describeD2lFailure(err, { school: "nyp", courseId: "nyp:99999999", access: notEnrolled });
    assert.match(msg, /aren't enrolled|doesn't exist/);
    assert.match(msg, /list_courses/);
    assert.doesNotMatch(msg, /isn't enabled/);
  }
});

test("404 for an enrolled user lists the possible causes rather than claiming the tool is disabled", () => {
  const msg = describeD2lFailure(new NotFoundError("x", 404, route), { school: "nyp", courseId: "nyp:524042", access: enrolledTutor });
  assert.match(msg, /item id you passed/);
  assert.match(msg, /isn't enabled for the course/);
  assert.doesNotMatch(msg, /not a session problem/);
});

test("400 surfaces D2L's own detail and is not described as a permission or 'not enabled' problem", () => {
  const msg = describeD2lFailure(new BadRequestError("x", 400, route, "Request has missing or invalid parameters."), {
    school: "nyp",
    courseId: "nyp:524042",
  });
  assert.match(msg, /invalid \(400\)/);
  assert.match(msg, /missing or invalid parameters/);
  assert.doesNotMatch(msg, /isn't enabled|refused this request/);
});

test("other statuses are reported as D2L-side errors with the status code", () => {
  const msg = describeD2lFailure(new D2lHttpError("x", 502, route), { school: "politemall" });
  assert.match(msg, /HTTP 502/);
  assert.match(msg, /D2L-side/);
});

test("without a course (cross-course or global calls) messages name the school, not a course", () => {
  const msg = describeD2lFailure(new NotFoundError("x", 404, "le/1.97/content/myItems/completions/due/"), { school: "nyp" });
  assert.match(msg, /your nyp account/);
});

# Tasks

## 1. Live-tenant spike (do this first; it decides whether the rest is viable)

- [x] 1.1 In a sandbox course the user owns, call the Valence quiz and question write routes once each by hand with a signed-in session (create quiz, create one question of each supported type, update each, update the quiz). Record the real request/response bodies under `server/control-plane/tests/fixtures/quiz-write/` (no tokens, cookies or personal data) and write down in design.md's Open Questions the answers: scope accepted or rejected, required `QuizData` fields, `RichTextInput` shape, evaluation/grading enum values. Verify: fixtures committed and the three Open Questions resolved in design.md. Stop and report to the user if the token lacks the write scopes.

## 2. D2L client write path

- [x] 2.1 Add `apiSend` (POST/PUT with JSON body, same version substitution, auth headers, `redirect: "manual"`, `failFor` mapping, `Accept: application/json`) to `src/api/d2l-client.ts`. Verify: unit test with a stubbed `fetch` covers method, body, headers, 200 JSON parse, and 400/403/404/429/401 error mapping.
- [x] 2.2 Add a "supports question writes" check using the discovered `le` version (`>= 1.100`) with a clear error naming school and version. Verify: unit test with primed versions 1.99 (refuse) and 1.100 (allow).

## 3. Quiz and question builders (pure functions)

- [x] 3.1 Create `src/api/quiz-authoring.ts` with zod schemas for quiz settings (name, instructions, description, isActive, startDate, endDate, dueDate, attemptsAllowed 1-10 or null, timeLimitMinutes, shuffleQuestions, allowHints, preventMovingBackwards) including cross-field checks (end ≥ start). Verify: unit tests for each rule, including attempts 11 and end-before-start rejected.
- [x] 3.2 Add the question discriminated union and `buildQuestion(question) → QuestionDataJSON` for the seven types, plain-text default with `textFormat: "html"` opt-in, default `points` 1, generated matching choice ids. Verify: unit tests compare output with the fixtures from 1.1 for every type; exactly-one-correct and at-least-one-correct rules reject; matching distractors produce the extra choices.
- [x] 3.3 Add `toWriteModel(quizReadData)` and `mergeQuizUpdate(current, patch)`. Verify: unit test that an update of only `dueDate` leaves every other field of a fixture quiz identical, and that an empty patch is rejected.

## 4. Tools

- [x] 4.1 Add `WRITE` and `WRITE_OVERWRITE` annotation constants to `src/tools/schemas.ts` and a shared `dryRun` field. Verify: compiles and constants are used by 4.2–4.4.
- [x] 4.2 Implement `create_quiz` (`src/tools/create-quiz.ts`): validate, `dryRun`, inactive by default, return quiz plus `quizId` and link. Verify: tool test with stubbed D2L covers default-inactive, dry run sends nothing, validation error sends nothing, 403 gives the permission message, not-signed-in gives sign-in guidance.
- [x] 4.3 Implement `update_quiz` (`src/tools/update-quiz.ts`): GET, merge, PUT; reject empty patch; not-found handling; `dryRun` performs only the GET. Verify: tool test asserts the PUT body equals the merged fixture and a missing quiz yields a not-found result with no PUT.
- [x] 4.4 Implement `save_quiz_questions` (`src/tools/save-quiz-questions.ts`): validate all first, version check, sequential create/update, stop on first failure, structured result (done / failed / notAttempted), cap 100, `dryRun`. Verify: tool test with a stub that fails the 7th of 20 asserts 6 ids reported, failure reason, 13 not attempted, and no 8th request; a 429 is not retried.
- [x] 4.5 Register the three tools in `src/tools/index.ts` and add `LINK_POLICY` entries in `src/tools/link-policy.ts`. Verify: `npm test` link-policy and evidence-link tests pass.

## 5. Guardrail tests and docs

- [x] 5.1 Update `tests/tools/annotations.test.ts` and `tests/tools/tool-set.test.ts`: 39 tools; read tools keep `readOnlyHint: true`; exactly `create_quiz`, `update_quiz`, `save_quiz_questions` are non-read-only with the annotations in the spec. Verify: tests pass and fail if a fourth write tool is added.
- [x] 5.2 Add a test that `call_d2l_operation` rejects an operation key for a write route and that the catalog still has no non-GET entry. Verify: test passes.
- [x] 5.3 Update `README.md`: tool table rows for the three tools, an input example for `save_quiz_questions`, and replace any "all tools are read-only" statement. Verify: `grep -n -i "read-only" README.md` shows no claim that contradicts the new tools.
- [x] 5.4 Update `.claude/rules/cicd.md` "Never" list only if it says anything about read-only behavior (expected: no change needed). Verify: file reviewed, change recorded in the PR or "no change needed" noted.

## 6. Full verification

- [x] 6.1 Run `npm ci && npm run build && npm test && npm run smoke` in `server/control-plane`. Verify: all green.
- [ ] 6.2 Using a local server against the sandbox course from 1.1, run an end-to-end pass: dry run, create a hidden quiz, save a mixed batch of questions, update the due date, confirm in the D2L UI that nothing else changed. Verify: instructor confirms the quiz looks right in D2L; note results in the PR.
- [ ] 6.3 Open the PR titled `feat: add quiz create/update tools`, linking this change. Verify: `test`, `docker`, `package`, `openspec` and `pr-title` checks green. After merge, archive with `/opsx:archive` in its own `chore:` PR.

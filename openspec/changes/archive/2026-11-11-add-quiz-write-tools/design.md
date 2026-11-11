# Design

## Context

- All 36 tools are `GET`-only. `server/control-plane/src/api/d2l-client.ts` has `apiGet`/`apiGetFile`; the route catalog (`route-catalog.ts`) and `call_d2l_operation` are GET-only by spec (`d2l-route-catalog`).
- Auth is an opaque credential string; normally `Bearer <token>` minted at sign-in with `scope=*:*:*` (`auth/token-mint.ts`). Bearer calls need no XSRF header. `withRecovery` re-runs a call once after a `SessionExpiredError` (a 401 or login redirect, which D2L answers before processing).
- Tools follow one pattern: `runForD2LCourse(ctx, courseId, fn)` resolves the school and credential, runs `fn`, and maps D2L errors to messages.
- Valence write routes (from the Valence docs, Oct 2026; the docs do not mark which fields are required, so all of this is to be confirmed against a live tenant, see Open Questions):
  - `POST /le/{v}/{ou}/quizzes/` and `PUT .../quizzes/{quizId}` take `QuizData`; `PUT` **replaces every property**. `POST/PUT .../quizzes/{quizId}/questions/[{questionId}]` take `QuestionDataJSON` (from `le` 1.100). Question type cannot change after creation.
  - There is no route to attach, detach or reorder questions, and none to delete a question. Questions live under their quiz and appear in creation order.
  - Scopes: `quizzing:quizzes:create` / `:write` / `:read`. Valence also has category and special-access write routes (not used here).

## Goals / Non-Goals

**Goals:**
- Let an agent turn a question list it has already parsed into a D2L quiz in a small number of calls.
- Make the first write tools hard to misuse: nothing student-visible by accident, nothing lost by a partial update, nothing sent that failed validation.

**Non-Goals:**
- Parsing Excel/CSV/Word, deduplicating, or judging question quality: that is the calling agent's job.
- Any delete, restore or bulk-copy-between-courses behavior.
- A generic "write any Valence route" tool. Writes are curated, one workflow at a time.

## Decisions

### 1. Three tools: `create_quiz`, `update_quiz`, `save_quiz_questions`
They map one-to-one onto Valence's two resources (quiz, question) and onto how the work happens: create the shell, then fill it, then adjust. Alternatives:
- *One `upsert_quiz` taking quiz + questions*: one call for the common case, but a 60-question payload is one all-or-nothing-looking call that is not actually atomic, and "update" semantics for the question list (replace? merge? by what key?) become ambiguous because Valence has no replace-all-questions route.
- *Two tools (quiz, questions)*: collapses create and update by presence of an id. Rejected for quizzes because create and update differ in risk (update can overwrite settings, create cannot) and carry different annotations and descriptions the client shows when asking for approval. `save_quiz_questions` does use presence of `questionId` to choose create vs update because both are the same risk class and the same payload.
- *Separate `create_question` / `update_question`*: forces the agent to loop 60 times. The batch tool does the loop server-side.

Typical flow: `create_quiz` → `save_quiz_questions` → (optional) `update_quiz` with `isActive: true` once the instructor has looked at it.

### 2. Question input is a discriminated union with answer-level facts only
Fields the agent has in a spreadsheet: question text, options, which are right, points, feedback. The tool takes exactly those and builds D2L's weights, enumeration codes and ids:

| `type` | Input | Maps to |
|---|---|---|
| `multiple_choice` | `answers: [{text, correct, feedback?}]`, exactly 1 correct; `randomize?` | MultipleChoice (1), weight 1 for the correct one, 0 otherwise |
| `true_false` | `answer: boolean`, `trueFeedback?`, `falseFeedback?` | TrueFalse (2) |
| `multi_select` | `answers: [{text, correct, feedback?}]`, ≥1 correct | MultiSelect (4) |
| `short_answer` | `answers: string[]` (accepted answers; case rule left to D2L default) | ShortAnswer (8), one blank |
| `written_response` | `answerKey?` | LongAnswer (7), instructor-graded |
| `matching` | `pairs: [{prompt, match}]`, `distractors?: string[]` | Matching (5); server generates the choice ids |
| `ordering` | `items: string[]` in correct order | Ordering (6) |

Common: `text`, `points` (default 1), `hint?`, `feedback?`, `textFormat?: "text" | "html"` (default `"text"`), `questionId?` (update). Not supported in v1 (rejected with a clear message): fill-in-the-blank (3), arithmetic (12), significant figures (13), multi-short-answer (14); Likert/Image/Text have no documented write block. Adding a type later is an additive change to the union and the builder.

Why not accept D2L's native `QuestionDataJSON`? Agents would have to learn D2L's enums and weight rules, and mistakes (weights not summing to 1, wrong `QuestionTypeId`) surface as opaque 400s. Why not accept a flat table (row = question, columns A–E)? That pushes the format guessing the user wanted kept out of the tool back into it. A typed union is validated by zod before any network call, and the MCP client shows the schema to the model, which then produces valid JSON on the first try.

### 3. Plain text by default; HTML opt-in
Source files hold plain text. D2L rich-text fields take `{Content, Type}`. The builder sends `Type: "Text"` unless `textFormat: "html"`, so a literal `<` in a chemistry question is not eaten as markup.

### 4. `update_quiz` reads, merges, then writes
Because `PUT` replaces everything, a naive tool would reset unspecified settings to defaults (re-hiding or un-hiding quizzes, dropping time limits). `update_quiz` does `GET quiz` → convert the read model (`QuizReadData`, `RichText`) to a write model (`QuizData`, `RichTextInput`) → overlay the supplied fields → `PUT`. A pure function does the conversion, so it is unit-tested against recorded shapes. The read-then-write is not transactional; a concurrent edit by another instructor between the two calls can be overwritten. Accepted: the window is milliseconds and editing the same quiz from two places at once is rare. Alternative (expose raw `QuizData` and let the caller send everything) was rejected: it makes every call a data-loss risk and bloats the schema.

### 5. Batch semantics: validate all, send in order, stop on first failure, report precisely
No D2L route is transactional, and question order is creation order. So: (1) zod-validate every question first (cheap, catches almost all errors, nothing sent); (2) send sequentially; (3) on the first D2L error stop, because continuing would put later questions ahead of a missing one and make the quiz order wrong; (4) return `{created/updated: [{index, questionId}], failed: {index, reason}, notAttempted: [indices]}`. The agent retries by passing the remaining questions (new) — and the `questionId`s it was given for ones it wants to correct. Cap 100 questions per call to keep a call within one request timeout. Alternative: continue past failures. Rejected for the ordering reason above.

### 6. Safety for the first writing tools
- MCP annotations: `readOnlyHint:false`; `destructiveHint:true` for the two tools that can overwrite, `false` for create. Clients use these to prompt the user for approval. A new `WRITE`/`WRITE_OVERWRITE` constant sits next to `READ_ONLY` in `schemas.ts`.
- Inactive by default on create, so a half-built quiz is never student-visible.
- `dryRun` on every write tool; the first run in any session can be a dry run and the agent can show the instructor what will be created.
- No delete tools. A mistake is fixed by `update_quiz` / `save_quiz_questions` or by the instructor in the D2L UI.
- Course boundary: `orgUnitId` always comes from the `courseId` argument via `parseCourseId`, never from user-provided path parameters (same rule as the read side).
- Prompt-injection note: an agent that has just read course content or a spreadsheet could be told by that content to create quizzes. The approval prompt the client shows for non-read-only tools is the control; the server adds nothing that bypasses it, and does not accept a "skip confirmation" argument.
- Writes are never retried automatically, except through the existing `withRecovery` path, which only replays after a 401 / login redirect, a response D2L gives before processing. A 429 or timeout is reported.

### 7. A separate write path in the D2L client, outside the catalog
Add `apiSend(school, method, path, auth, body)` (JSON body, `Content-Type: application/json`, same version-substitution, same `failFor` error mapping, same `redirect: "manual"`). Paths are built by small functions in the new quiz-authoring module, not by the catalog, because the catalog's spec says GET-only and `call_d2l_operation` must stay unable to write. The Valence version check for question routes (`le` ≥ 1.100) uses the already-discovered version.

### 8. Result shape and links
Create and update return the quiz as D2L stored it (with `...Sgt` date companions, as `get_quizzes` does) and `sourceUrl`/`pageUrl` per the link policy: `create_quiz`/`update_quiz` link the quiz; `save_quiz_questions` links the quiz page. Each new tool gets a `LINK_POLICY` entry (a test enforces that).

## Risks / Trade-offs

- [Docs are summarized and incomplete: required fields, the `RichTextInput` shape and the evaluation enums are not fully specified] → First task is a live-tenant spike against a sandbox course that records real request/response bodies as test fixtures; the builder is written against those, not against the docs alone.
- [Bearer token scope may not cover `quizzing:quizzes:create/write` despite `*:*:*`] → The spike tests this first. If it fails, sign-in needs a different scope, which is a separate change; this one stops there.
- [Partial batch leaves a half-filled inactive quiz] → Inactive by default; the failure report lists exactly what exists; the agent can continue with the rest.
- [A retried `create_quiz` creates a duplicate] → Description says so; result returns `quizId`; the agent should call `get_quizzes` before retrying after an ambiguous failure.
- [Editing a quiz that already has attempts may affect them in ways the docs do not describe] → `update_quiz` and `save_quiz_questions` include a note in their description; no extra guard in v1. If instructors hit this, add a refusal when the quiz has attempts.
- [Students use the same server, so a student account can reach write tools] → D2L denies with 403 for non-managers; the error message says the account cannot manage quizzes. Tool descriptions say "instructor/TA".
- [Moving off "all tools read-only" weakens a global guarantee in the README and specs] → Spec and README updated explicitly; tests assert the exact set of write tools so a fourth cannot appear unnoticed.

## Migration Plan

Additive; no data migration. Ship by normal PR → release-please → npm. Deploy to the hosted server is a separate manual step requested explicitly. Rollback: revert the PR; D2L quizzes created in the meantime remain in D2L.

## Spike findings (task 1.1, run 2026-10-23 on NYP, `le` 1.100, a sandbox course)

Recorded exchanges: `server/control-plane/tests/fixtures/quiz-write/recorded-exchanges.json`.

- The Bearer token minted at sign-in (`scope=*:*:*`) is accepted for quiz create/update and question create/update. No sign-in change is needed.
- Quiz create needs `SubmissionGracePeriod` to be a number (0), not null, or D2L answers 400 "Grace period must be provided".
- D2L reads attempts as `AttemptsAllowed {IsUnlimited, NumberOfAttemptsAllowed}` but takes a bare `NumberOfAttemptsAllowed`; `update_quiz` converts between them.
- Question bodies must contain no `null` values (400 "JSON Binding Error"); unset values are left out. `Difficulty` and `Enumeration` are optional.
- Rich text is `{Content, Type: "Text" | "Html"}` everywhere on write, including `QuestionText`. A `{Text, Html}` body is rejected.
- Answer weights are 0 to 1 on write (stored and read back as 0 to 100).
- A question update must not send `QuestionTypeId` (400 "Unrecognized question properties"); only a create sends it.
- All seven supported types were created, read back, and matched what was sent. Matching choice ids are assigned by D2L, and `CorrectChoiceId` was resolved correctly from the ids the tool generated.
- Writes through `update_quiz` changed only the supplied fields (verified by diffing the raw quiz before and after).
- A rejected question create leaves nothing behind.

## Open Questions

- Case-sensitivity of short answers: D2L stored `EvaluationType: 0` for the default; the other values are not mapped, so the tool offers no case option.
- Effect of `update_quiz` / `save_quiz_questions` on a quiz that already has attempts is untested.

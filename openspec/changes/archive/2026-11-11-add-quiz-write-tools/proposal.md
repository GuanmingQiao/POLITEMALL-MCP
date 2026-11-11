## Why

Every tool the server has today only reads from D2L. Instructors now ask an agent to turn a question bank they already have (Excel, CSV, Word, a pasted list) into a Brightspace quiz, and today they must retype it in the quiz builder. Brightspace's Valence API has write routes for quizzes and quiz questions, so the server can take that over once the agent has parsed the source file into structured data.

## What Changes

- Add three **write** tools, mirroring Valence's own split between a quiz and its questions:
  - `create_quiz`: create a quiz in a course (settings only; created inactive/hidden unless told otherwise).
  - `update_quiz`: change settings of an existing quiz. Valence's `PUT` replaces every property, so the tool reads the quiz first and merges only the fields the caller supplied.
  - `save_quiz_questions`: add questions to a quiz, or update existing ones, in one batch.
- Question input is structured JSON, a discriminated union on `type`: `multiple_choice`, `true_false`, `multi_select`, `short_answer`, `written_response`, `matching`, `ordering`. The server does no file parsing; the calling agent reads Excel/CSV/Docs and produces this JSON. Plain text is the default for question and answer text; HTML is opt-in.
- Every write tool accepts `dryRun: true`, which validates the input and returns the exact D2L request(s) it would send without sending them.
- Add a write HTTP path to the D2L client (POST/PUT with a JSON body) next to the existing GET helpers. The route catalog and `call_d2l_operation` stay GET-only.
- Write tools are annotated `readOnlyHint: false` so MCP clients ask the user before running them.
- **BREAKING (internal contract only):** the rule "every D2L tool is read-only" no longer holds; the tool-annotation requirement and its test are narrowed to "every tool except the declared write tools".

Out of scope: deleting quizzes, questions or categories; quiz categories; special access; attaching existing questions from the question library; reordering questions; fill-in-the-blank, arithmetic, significant-figures, multi-short-answer and Likert questions; surveys; parsing source files.

## Capabilities

### New Capabilities
- `quiz-authoring-tools`: the three write tools, their structured input, dry-run, merge-on-update, and safety behavior.

### Modified Capabilities
- `d2l-mcp-tool-surface`: "Read-only tools are annotated as such" is narrowed so that the named write tools are annotated as non-read-only, and all other tools stay read-only.

## Impact

- Code: new `server/control-plane/src/tools/{create-quiz,update-quiz,save-quiz-questions}.ts`, a question builder under `src/api/` (input to D2L `QuestionDataJSON`), write helpers in `src/api/d2l-client.ts`, registration in `src/tools/index.ts`, link policy entries, `src/tools/schemas.ts` (`WRITE` annotations).
- Tests: new unit tests for the builder and tools; `annotations.test.ts` and `tool-set.test.ts` updated (tool count 36 → 39).
- Docs: `README.md` tool table and a short "writing tools" note.
- Runtime: the Bearer token minted at sign-in already requests `scope=*:*:*`, so no sign-in change is expected; to be confirmed against a live tenant (see design, open questions). Question routes need Valence `le` 1.100 or newer, which version discovery already prefers.
- Security: first tools that change tenant data; mitigations are in the design (client approval via annotations, dry run, inactive-by-default, no delete).
- No change to CI/CD, release or deploy procedure. Deployment to AWS remains a separate manual step.

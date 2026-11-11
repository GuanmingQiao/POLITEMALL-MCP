# Spec Delta

## Purpose

Lets an agent create and edit D2L quizzes and their questions from structured data it has already extracted from a source file, so instructors do not retype question banks into the quiz builder.

## ADDED Requirements

### Requirement: Quiz writing is exposed as three tools mirroring D2L's quiz and question split
The system SHALL expose `create_quiz`, `update_quiz` and `save_quiz_questions`. Each SHALL be course-scoped (taking the `courseId` from `list_courses`), SHALL act only inside that course, and SHALL use the signed-in caller's own D2L permissions. The system SHALL NOT expose any tool that deletes a quiz, a question or a category.

#### Scenario: tools are listed
- **WHEN** a client lists the server's tools
- **THEN** `create_quiz`, `update_quiz` and `save_quiz_questions` SHALL be present and no quiz-deleting tool SHALL be

#### Scenario: caller lacks permission
- **WHEN** a caller without permission to manage quizzes in the course calls any of the three tools
- **THEN** the tool SHALL return an error result saying the account lacks permission, and SHALL NOT report success

#### Scenario: caller is not signed in to the course's school
- **WHEN** any of the three tools is called for a school the caller has no session for
- **THEN** the tool SHALL return the same sign-in guidance the read tools give and SHALL send nothing to D2L

### Requirement: Input is structured data, never a file
The tools SHALL accept only structured JSON arguments. They SHALL NOT accept file contents, file paths or URLs to parse. Text fields SHALL be plain text unless the caller marks them as HTML.

#### Scenario: plain text is not interpreted as markup
- **WHEN** a question's text contains `<b>` characters and the caller did not mark it as HTML
- **THEN** the quiz SHALL show those characters literally rather than as formatting

### Requirement: Quizzes are created hidden by default
`create_quiz` SHALL create the quiz inactive (not visible to students) unless the caller explicitly sets it active. The result SHALL include the new quiz's `quizId`, its resulting settings and a link to the quiz when evidence links are enabled.

#### Scenario: default creation
- **WHEN** a caller creates a quiz giving only a name
- **THEN** the quiz SHALL be created inactive and the result SHALL contain its `quizId`

#### Scenario: invalid settings are rejected before any request
- **WHEN** a caller supplies `attemptsAllowed` of 11, or an `endDate` earlier than `startDate`
- **THEN** the tool SHALL return a validation error and SHALL send nothing to D2L

### Requirement: Updating a quiz changes only the fields supplied
`update_quiz` SHALL change only the settings the caller supplies and SHALL leave every other setting of the quiz as it was, even though D2L itself replaces all settings on a write. A call that supplies no settings SHALL be rejected.

#### Scenario: partial update
- **WHEN** a caller updates only `dueDate` on a quiz that has a time limit and instructions
- **THEN** the quiz SHALL keep its time limit and instructions and have the new due date

#### Scenario: no fields supplied
- **WHEN** a caller calls `update_quiz` with only `courseId` and `quizId`
- **THEN** the tool SHALL return an error result and SHALL NOT write to D2L

#### Scenario: quiz does not exist
- **WHEN** the `quizId` does not exist in the course
- **THEN** the tool SHALL return a not-found error result and SHALL NOT create anything

### Requirement: Questions are described by type with friendly, server-validated fields
`save_quiz_questions` SHALL accept a list of questions, each a variant selected by `type`: `multiple_choice`, `true_false`, `multi_select`, `short_answer`, `written_response`, `matching`, `ordering`. Each question SHALL carry its text and optional `points` (default 1), `hint` and `feedback`. Correct answers SHALL be stated with plain fields (a `correct` flag per answer, a boolean for true/false, accepted strings for short answer, prompt/match pairs for matching, items in correct order for ordering); callers SHALL NOT need to supply D2L weights, ids or enumeration codes. All questions SHALL be validated before any request is sent.

#### Scenario: multiple choice with one correct answer
- **WHEN** a caller saves a `multiple_choice` question with four answers, exactly one marked `correct`
- **THEN** the question SHALL be created so that only that answer earns the points

#### Scenario: multiple choice with no correct answer
- **WHEN** a `multiple_choice` question has zero or more than one `correct` answer
- **THEN** the tool SHALL return a validation error naming the question's position and SHALL send nothing to D2L

#### Scenario: unsupported type
- **WHEN** a question has a `type` outside the supported list
- **THEN** the tool SHALL return a validation error listing the supported types and SHALL send nothing to D2L

#### Scenario: matching with extra wrong choices
- **WHEN** a `matching` question lists three prompt/match pairs and two `distractors`
- **THEN** the question SHALL offer five choices, with each prompt's correct choice being its own match

### Requirement: Questions are created or updated in one ordered batch
Each question in a `save_quiz_questions` call SHALL be created when it has no `questionId` and updated in place when it has one. Questions SHALL be sent to D2L one at a time in the order given. An update SHALL NOT change a question's type; a mismatch between the given `type` and the existing question's type SHALL be an error for that question. The batch is not atomic: on the first D2L failure the tool SHALL stop and report which questions were created or updated (with their `questionId`s), which one failed and why, and which were not attempted.

#### Scenario: all succeed
- **WHEN** a caller saves 20 new questions and all succeed
- **THEN** the result SHALL list 20 created questions with their `questionId`s in the order given

#### Scenario: failure partway
- **WHEN** the 7th of 20 questions is rejected by D2L
- **THEN** the result SHALL be an error that lists the 6 created `questionId`s, the failure of question 7 with D2L's reason, and that questions 8 to 20 were not attempted

#### Scenario: update an existing question
- **WHEN** a question is given with an existing `questionId` and new text
- **THEN** that question SHALL be updated rather than a new one created

#### Scenario: oversized batch
- **WHEN** a call contains more than 100 questions
- **THEN** the tool SHALL return a validation error and send nothing to D2L

### Requirement: Question writing needs a D2L version that supports it
Before writing questions, the system SHALL check that the school's discovered Learning Environment API version supports question writing, and SHALL return an explanatory error naming the school and its version when it does not.

#### Scenario: tenant too old
- **WHEN** a school's discovered `le` version is older than the first version with question write routes
- **THEN** `save_quiz_questions` SHALL return an error saying so and SHALL send no question request

### Requirement: Dry run shows what would be sent without sending it
Each write tool SHALL accept `dryRun`. When true, the tool SHALL perform all validation (and, for `update_quiz`, the read of the current quiz) and SHALL return the request(s) it would send, and SHALL NOT create or change anything in D2L.

#### Scenario: dry run of a batch
- **WHEN** a caller sets `dryRun` on `save_quiz_questions` with valid questions
- **THEN** the result SHALL show each question as it would be sent and D2L SHALL have received no write

### Requirement: Write tools are annotated as modifying
Each write tool SHALL be annotated `readOnlyHint: false`. `update_quiz` and `save_quiz_questions` (which can overwrite existing content) SHALL be annotated `destructiveHint: true`; `create_quiz` SHALL be annotated `destructiveHint: false`. Their descriptions SHALL say they change the school's data and that retrying `create_quiz` creates a second quiz.

#### Scenario: annotations
- **WHEN** a client inspects the three tools
- **THEN** they SHALL carry the annotations above

### Requirement: Writes are never retried blindly
The system SHALL NOT repeat a write request after a failure other than an expired session answered before the request was processed. A throttled or timed-out write SHALL be reported to the caller, who decides whether to retry.

#### Scenario: throttled write
- **WHEN** D2L answers a question write with 429
- **THEN** the tool SHALL stop, report the question as failed with a "try again later" message, and SHALL NOT resend it automatically

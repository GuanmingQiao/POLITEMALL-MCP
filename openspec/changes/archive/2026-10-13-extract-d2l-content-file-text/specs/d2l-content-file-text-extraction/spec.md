# Spec Delta

## Purpose

Lets a client read the content of a course lesson's attached file directly, by extracting
the plain text of a file-type content topic's `.docx` or `.pdf` attachment instead
of only exposing the topic's metadata and link.

## ADDED Requirements

### Requirement: Supported file-type topic attachments are extracted to plain text
When a content topic's underlying file is a `.docx` or `.pdf`, the system SHALL
fetch that file and return its extracted plain text alongside the topic's existing metadata.

#### Scenario: extracting a Word document
- **WHEN** a client requests a content topic whose attached file is a `.docx`
- **THEN** the response SHALL include the extracted plain text of that document

#### Scenario: extracting a PDF
- **WHEN** a client requests a content topic whose attached file is a `.pdf`
- **THEN** the response SHALL include the extracted plain text of that PDF

### Requirement: Extraction is scoped to file-type topics in a supported format
The system SHALL NOT attempt extraction for a topic that is not a file-type topic, or whose
attached file is not `.docx` or `.pdf`. Such a topic's response SHALL be unaffected
by this capability.

#### Scenario: non-file topic is unaffected
- **WHEN** a client requests a content topic that is a link or native page, not a file attachment
- **THEN** the response SHALL contain no extracted-text field, exactly as before this capability existed

#### Scenario: unsupported attachment format is unaffected
- **WHEN** a client requests a file-type content topic whose attached file is not `.docx` or `.pdf` (e.g. a `.pptx`, a spreadsheet, or an image)
- **THEN** the system SHALL NOT attempt extraction, and the response SHALL contain no extracted-text field

### Requirement: Existing topic metadata and behavior are preserved
Every field a content topic's response contained before this capability SHALL remain
present and unchanged. This capability only ever adds information; it never removes or
alters an existing field, and it never replaces returning a topic's existing metadata.

#### Scenario: metadata fields unchanged when extraction succeeds
- **WHEN** a client requests a file-type content topic whose attachment is successfully extracted
- **THEN** the response SHALL still include every metadata field (title, dates, `Url`, etc.) it included before this capability existed

### Requirement: An extraction failure does not fail the content topic request
If the attached file cannot be fetched or its text cannot be extracted — because it is
corrupted, unreadable, exceeds a configured maximum size, or contains no extractable text
(e.g. a scanned, image-only PDF) — the system SHALL still return the topic's existing
metadata, with an explanatory note in place of extracted text, rather than failing the
request.

#### Scenario: oversized attachment
- **WHEN** a client requests a file-type content topic whose attached file exceeds the configured maximum size for extraction
- **THEN** the response SHALL include the topic's existing metadata and an explanatory note instead of extracted text, and SHALL NOT be an error result

#### Scenario: corrupted or unparsable attachment
- **WHEN** a client requests a file-type content topic whose attached file cannot be parsed in its declared format
- **THEN** the response SHALL include the topic's existing metadata and an explanatory note instead of extracted text, and SHALL NOT be an error result

### Requirement: Fetching the attached file honors the same session and permission errors as other D2L requests
A failure while fetching the attached file itself (an expired session, or a permission
error) SHALL be reported using the same error categories the rest of the D2L tool surface
uses, rather than a distinct or unrecognized error shape.

#### Scenario: session expired while fetching the attachment
- **WHEN** a client requests a file-type content topic and the caller's D2L session has expired
- **THEN** the system SHALL return the same session-expired error result other D2L tools return in that situation, not a partial or malformed response

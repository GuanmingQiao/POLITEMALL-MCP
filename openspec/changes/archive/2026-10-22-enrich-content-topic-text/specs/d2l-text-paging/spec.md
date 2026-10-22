## ADDED Requirements

### Requirement: Long extracted text is returned in bounded slices
Any tool that returns text extracted from a document or page SHALL return at most a requested number of characters (default 20 000, never more than 100 000) starting at a requested character offset (default 0), rather than the whole text.

#### Scenario: short document fits
- **WHEN** a document's text is no longer than the requested size
- **THEN** the full text SHALL be returned and the response SHALL report it as not truncated

#### Scenario: long document is cut
- **WHEN** a document's text is longer than the requested size
- **THEN** only the first slice SHALL be returned, and the response SHALL state that it was truncated

### Requirement: Truncation is reported and resumable
Whenever text is returned, the response SHALL state the document's total text length, whether the returned slice was truncated, and, when more remains, the offset at which to continue.

#### Scenario: continuing a long document
- **WHEN** a client repeats the request using the reported continuation offset
- **THEN** the response SHALL contain the text immediately following the previous slice, with no gap or overlap

#### Scenario: last slice
- **WHEN** the returned slice reaches the end of the document
- **THEN** the response SHALL be marked not truncated and SHALL NOT offer a further offset

#### Scenario: offset beyond the end
- **WHEN** a client requests an offset at or past the end of the text
- **THEN** the response SHALL return no text, report the total length, and SHALL NOT be an error

### Requirement: Slices do not split a character
A slice boundary SHALL NOT fall inside a multi-unit character (surrogate pair).

#### Scenario: emoji at the boundary
- **WHEN** the requested size would end between the two halves of an emoji
- **THEN** the slice SHALL end before the emoji and the continuation offset SHALL start at it

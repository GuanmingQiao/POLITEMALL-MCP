## MODIFIED Requirements

### Requirement: Supported file-type topic attachments are extracted to plain text
When a content topic's underlying file is a `.pdf`, `.docx`, `.pptx`, an HTML page, or a plain-text file, the system SHALL fetch that file and return its extracted text alongside the topic's existing metadata. HTML SHALL be returned as Markdown that keeps headings, lists, tables and links and omits scripts and styles. The text SHALL be returned as a bounded slice per the `d2l-text-paging` capability.

#### Scenario: extracting a Word document
- **WHEN** a client requests a content topic whose attached file is a `.docx`
- **THEN** the response SHALL include the extracted plain text of that document

#### Scenario: extracting a PDF
- **WHEN** a client requests a content topic whose attached file is a `.pdf`
- **THEN** the response SHALL include the extracted plain text of that PDF

#### Scenario: extracting an HTML page
- **WHEN** a client requests a content topic whose attached file is an HTML page
- **THEN** the response SHALL include that page's content as Markdown, with no script or style code in it

#### Scenario: extracting a slide deck
- **WHEN** a client requests a content topic whose attached file is a `.pptx`
- **THEN** the response SHALL include the text of its slides in slide order

### Requirement: Extraction is scoped to file-type topics in a supported format
The system SHALL NOT attempt extraction for a topic that is not a file-type topic, or whose attached file is in a format it cannot read as text (for example a spreadsheet, an image or a video). Such a topic's response SHALL be unaffected by this capability.

#### Scenario: non-file topic is unaffected
- **WHEN** a client requests a content topic that is a link, not a file attachment
- **THEN** the response SHALL contain no extracted-text field

#### Scenario: unsupported attachment format is unaffected
- **WHEN** a client requests a file-type content topic whose attached file is a spreadsheet or an image
- **THEN** the system SHALL NOT attempt extraction, and the response SHALL contain no extracted-text field

## ADDED Requirements

### Requirement: Native page descriptions are readable
When a content topic carries its own page content as an HTML description, the system SHALL return that content as Markdown.

#### Scenario: topic with an HTML description
- **WHEN** a client requests a content topic whose metadata includes an HTML description
- **THEN** the response SHALL include that description converted to Markdown, and the original fields SHALL remain unchanged

### Requirement: Text written by others is marked untrusted
Text extracted from a topic's file or description that contains a web link SHALL be flagged as author-written, so links inside it are not presented as evidence or followed as instructions.

#### Scenario: HTML page with links
- **WHEN** the extracted text of a topic contains a link
- **THEN** the response SHALL carry the untrusted-links marker and note

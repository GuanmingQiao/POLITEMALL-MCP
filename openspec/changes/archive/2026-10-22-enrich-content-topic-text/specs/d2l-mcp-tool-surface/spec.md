## ADDED Requirements

### Requirement: Text responses from file routes are readable through the generic operation tool
When `call_d2l_operation` invokes a route that returns file content and the response is text (HTML, plain text or JSON), the system SHALL return it as text — HTML as Markdown — paged per the `d2l-text-paging` capability. A response that is genuinely binary SHALL still be refused with an explanatory error.

#### Scenario: HTML file route
- **WHEN** a client invokes the content-topic file operation for a topic whose file is an HTML page
- **THEN** the response SHALL contain the page as Markdown rather than a refusal

#### Scenario: true binary
- **WHEN** a client invokes a file operation whose response is an image, archive or other non-text content
- **THEN** the system SHALL refuse and say the content is binary

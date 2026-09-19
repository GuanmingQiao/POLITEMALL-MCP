# Third-party notices

## brightspace-mcp-server

Parts of this project's `get_course_content`, `get_announcements`, `get_classlist`,
`get_assignments` and `get_assignment_files` tools, and of the HTML-to-Markdown, PDF/Office
text-extraction and deep-link helpers, are adapted from
[brightspace-mcp-server](https://github.com/RohanMuppa/brightspace-mcp-server) by Rohan Muppa
(output shapes, filtering behaviour, draft/date handling, the privacy-first roster default,
quiz-attempt accounting, the ZIP reader for Office files, and the UI link templates). They were
rewritten for this project's multi-tenant, multi-school design and hardened for a shared server.
Each adapted file says so in its header comment.

The original is licensed under the MIT License:

```
MIT License

Copyright (c) 2026 Rohan Muppa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

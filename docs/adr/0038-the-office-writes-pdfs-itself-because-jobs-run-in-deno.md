# ADR-0038 — The office writes PDFs itself, because jobs run in Deno

**Status:** accepted · 2026-09-17 · Issue #258 · `src/artifacts/`

## Context

#258 begins with a real refusal:

> *"Grant asked the Agentic Team to inspect a document, research the subject,
> produce a beautifully illustrated PDF containing the relevant information,
> and send the finished PDF directly back through Telegram. The office said it
> did not have the means to do this."*

and states the invariant:

> *"IF THE OFFICE CAN RESEARCH AND WRITE THE CONTENT, IT SHOULD BE ABLE TO
> PACKAGE THAT WORK AS A REAL DELIVERABLE AND RETURN IT THROUGH THE CHANNEL
> THAT REQUESTED IT."*

The constraint that decides everything below is **where jobs run**. A job is
dequeued and handled inside `supabase/functions/worker`, which is Deno, cold
started, bundling 107 files, on a free tier.

## Decision

**The PDF is written byte by byte, in TypeScript, with no dependencies.**

Three alternatives were considered and each fails on the same constraint.

| Approach | Why not |
|---|---|
| **Chromium `page.pdf()`** | The obvious answer and the best output, and Playwright exists in this repository — in the AUTHORING session. There is no Chromium in an edge function and never will be. Building on it would mean the office can only make a PDF while an agent is running a script for it, which is the opposite of Grant's standing goal of reducing his dependence on a coding interface. |
| **`pdfkit` / `pdf-lib` from npm** | Free, so not a cost objection. A bundle objection: both pull a font subsetter and a stream stack into a function whose cold start is already the thing people notice, and neither is a Deno-first package. |
| **A hosted HTML-to-PDF API** | A paid dependency, or a free tier with a rate limit and somebody else's uptime, for the one step the Issue says must be provider-independent. |

Writing the format is less alarming than it sounds: a PDF is numbered objects,
a cross-reference table of byte offsets and a trailer. The hard part is
typography, and **that is a table of numbers** — the base-14 advance widths in
`metrics.ts`, extracted from the Liberation faces by a committed script and
checked against the published values before being trusted.

**Three modules, and the seam between them is the point.** `pdf.ts` knows about
bytes and nothing about reports. `report.ts` knows a report has a cover and
nothing about bytes. `validate.ts` reads the bytes back from the outside and
knows about neither. #258 asks for DOCX, slides and spreadsheets later; with
this seam, each is a second `report.ts` against a second writer rather than a
rewrite.

**Nothing claims an artifact exists until it has been read back.** The Issue's
own rule, implemented as a hard sequence: render → `validatePdf` → store →
deliver, with every failure reported in the words of whatever refused. The
validator follows every cross-reference offset and requires it to land on its
object, because that is the defect a hand-written writer actually produces and
it fails silently — a reader given bad offsets shows a blank document rather
than an error, so "it opens" proves nothing.

**A generated artifact is a `documents` row, not a new table.** Every field
#258 lists for a durable project record already exists there: `storage_path`,
`mime_type`, `byte_size` (#9, #66), `origin` and `produced_by` (0284),
`produced_by_job`. Writing it as a document also makes the rest free — it
appears in the project's Documents surface and is reachable by
`app.search_documents`, because the page and the search already read that
table. A parallel `generated_files` table would have been a second place for
the same facts, and 0310's rule is that the copy is the one that rots.

## Consequences

- **The office can make a real file at job time, unattended**, on any channel,
  with no script and no agent present. That is the capability Grant was
  refused.
- **No images.** The writer draws text, rules, rectangles and filled paths, so
  a chart is a real vector chart and a photograph is nothing. "Beautifully
  illustrated" is met with typography, tables and charts rather than with
  pictures. Embedding a JPEG is about thirty lines (`DCTDecode` takes the
  compressed bytes almost verbatim) and is not built because nothing the office
  holds is an image worth placing yet.
- **WinAnsi on the page, UTF-16 in the metadata**, which is what the format
  says and which the first version got wrong in both directions: a non-breaking
  hyphen became `?` in "high?performing", and an en dash written as WinAnsi
  0x96 in the title made Chromium show the tab as "Legacy Coaching Course OE
  Current Status Report". Anything outside the WinAnsi set with no stand-in
  still becomes a question mark, deliberately: a dropped character is a
  sentence that reads correctly and is wrong.
- **A generated report lands as `state = 'draft'`**, which means #28's review
  gate applies to it. That is the existing model working rather than a gap, and
  it is worth stating because it makes "it is in the project's documents" true
  in a slightly weaker sense than the Issue's wording implies.

## Alternatives rejected for the CONTENT, not the container

- **A model returning Markdown, converted here.** Tempting, and it loses every
  structure that makes the document worth having: a table becomes pipes, a
  chart becomes nothing, and the parser becomes the thing with the bugs. The
  model returns the report as typed blocks and `readReport` validates each one,
  dropping what it does not recognise rather than rendering a guess.
- **Letting the model choose the layout.** It cannot see the page. Every
  measurement that keeps a line inside the column and a heading off the bottom
  of a page is made here, where the width table is.

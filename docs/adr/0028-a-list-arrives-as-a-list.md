# ADR-0028 — A message that is a list arrives as a list

**Status:** accepted · 14 September 2026 · Issue #209 · narrows ADR-era #186

## Context

Grant, 14 September 2026:

> *"Ensure that messages sent on any platform, whether it be Telegram, Slack or
> the dashboard, if our paragraph should be separated by bullet points,
> enumerated bullet points. So a numbered list — just to keep things easy to
> read and easy to refer to."*

This appears to contradict a decision he made the day before. #186 —
*"I want messages in general from everyone to be more human and easier to
read"* — resulted in three system prompts carrying the literal instruction
**`no bullet points, no headings, no bold`**, on the reasoning that a bulleted
reply to a conversational question reads as a report rather than as a colleague
talking.

Both are right, about different content. The word that resolves them is his own:
***should***. He is not asking for every message to become a list.

## Decision

### 1. Prose is the default; a numbered list is for content that is a list

The prompts now say so in that order — prose first and named as the default, so
a model reading quickly does not come away thinking it should enumerate
everything. A list is called for when the content genuinely is one: options he
is choosing between, steps in an order, separate findings, things he needs to
decide. Two items or fewer is a sentence.

### 2. Numbered, never dashes

This is the whole reason he asked. *"Easy to refer to"* means he can reply
**"do 2 and 4"**. A dash is exactly as unreferenceable as a semicolon, so
bullets would satisfy the letter of the request and miss its point.

### 3. No markdown renderer. Each surface translates line breaks into its own markup

§5: an adapter may only translate. The model writes **one plain-text body** with
`1.` lines in it, and each surface renders the breaks in its own language:

| surface | how | state before #209 |
|---|---|---|
| Telegram | `escapeHtml` touches three characters; `trimForPager` collapses `\n{3,}` to `\n\n` | already correct |
| Slack | `splitBody` breaks on `\n\n`; sections are `mrkdwn` | already correct |
| studio | blank line starts a block; an all-numbered block becomes `<ol>` | **lost every newline** |

Nothing parses emphasis, links or headings. Adding a markdown library would put
three renderings of one body in three places, and the one that drifts is the one
nobody is looking at — which is exactly how this defect survived.

### 4. In the studio, an all-numbered block becomes a real `<ol>`

Not line breaks. Line breaks were tried first and the phone capture refuted
them: at 390px the continuation of item 1 wrapped into the column item 2 began
in, so **three items read as five** at the width he actually reads on. An
ordered list gets the hanging indent for nothing.

It also gets the semantics: a screen reader says *"list, 3 items"* before
reading them, which is the affordance #200 gave the thread itself.

The literal `N.` prefix is dropped and `start=` carries the first number, so a
model that begins at 4 continues from 4, while one that writes 1, 2, 2, 5 gets a
list that counts properly rather than a transcription of its mistake.

## Consequences

- **#186 is narrowed, not reversed.** Most replies are still prose, still two or
  three short paragraphs, still under 120 words.
- The three prompts now agree with each other. They did not: leaving
  `no bullet points` in one while another produced them is how a future agent
  "fixes" the wrong half.
- `src/projects/brief.ts` **keeps** its ban, deliberately. A project orientation
  brief is a document, not a message, and its prompt already imposes a fixed
  three-paragraph shape. Grant's instruction was about messages.
- `verify:chat` gained four checks and the control was run: three of the four go
  red on both device legs with the old rendering restored.

## What this cost, and the part worth keeping

**#186's paragraph structure had never rendered on the dashboard.** The model
was producing it, Telegram and Slack were showing it, and the studio ran it all
together into one block for as long as the studio has existed — because
`<p>${esc(m.text)}</p>` puts a whole body in one tag and HTML collapses
whitespace.

`verify:chat`, `verify:layouts` and `verify:access` were all green over it. One
long paragraph is not overflow, not low contrast, not small type and not a dead
control.

**Two of the three checks written for this were wrong before the third was
right**, and both were wrong the same way — they read pixels where the text
happened to land, passed on the phone while the defect was live, and failed only
on the desktop leg:

1. *Rendered height.* At 390px the run-together body wraps to thirteen lines by
   itself and cleared a six-line threshold.
2. *Whether item 2 begins at the left edge.* The phone wrap put it there
   anyway — +0px, with the defect in.

A check that is green on one leg for the right reason and green on the other for
the wrong one is worse than no check: the suite still reports a failure, you fix
what it names, and you never learn half of it was inert. What discriminates is
**structure compared against itself** — three blocks, three list items, each box
below the previous — never a measurement compared against a threshold.

## Alternatives rejected

**`white-space: pre-wrap` on the bubble.** One line of CSS, and it preserves
newlines. It gives no hanging indent, so the phone problem remains; it preserves
accidental double spaces; and it gives a screen reader nothing.

**A markdown renderer.** Three surfaces, three markup languages, §5.

**Always use bullets.** Undoes #186 and is not what he asked for.

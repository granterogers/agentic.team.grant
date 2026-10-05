# ADR-0063 — The loaded project is the project

**Status:** accepted · **Date:** 4 October 2026 · **Issue:** #416 · **Supersedes:** ADR-0050 (#376) for every screen that
has a project

## Context

ADR-0050 pinned the team dock to the thread it was opened on, so navigating did not move a conversation. It fixed a real
defect (a sent message vanishing from view) and left a worse one in place: a person standing in the Finance project who
typed "summarise the budget documents in this project" was talking to whichever project the dock had been opened on. The
header said "Filed under ..." and a one-press "Ask about X instead" repaired it, but the burden was on the person to notice.

Grant, 4 October: the project that is loaded in the trusted UI is authoritative. The session supplies the office and the
project; the model must not infer the project from natural language when one is loaded. With none loaded, project Team Chat
is not offered. A second project may be named for comparison and never silently changes the active one.

## Decision

**Team HQ.** On a project page the dock IS that project. Navigating to another project moves it; nothing is ever filed
under a project the person is not looking at, so there is no "Filed under" state and nothing to move. Where no project is
loaded (the portfolio, My tasks, Activity) the dock does not choose: it lists the active projects, and choosing one OPENS it.
The only choice that is not a project is the general Conversation, offered by name and pinned on purpose. The stored pin
survives only to carry that explicit choice and to keep the voice note and composer, which read their project from the
dock's own markup, in step with the page.

**Telegram, Slack and voice** have no loaded project. In order, `app.enqueue_inbound` resolves: a project an asset names;
the project the surface stated; a Slack channel's mapping; **a project named in the message (0880)**; the conversation's
remembered project; the general Conversation. A name resolves only when EXACTLY ONE project is named (two is a comparison,
which stays with the conversation), by the same deterministic whole-word match of name or alias that retrieval uses
(`app.projects_named_in`, no asking project), inside the message's own office. An explicit name is an explicit resolution,
so it is remembered for the rest of the exchange. No model decides it.

What is left is a message that POINTS at a project it has not named ("what is outstanding on this project?") in a
conversation with none established. The instruction handler asks "Which project do you mean?" listing the person's active
projects, instead of answering from the general Conversation. It reads the person's own words, never a rewrite, fires only
on a demonstrative reference ("this/that/the current/the same project"), never on a request to start a project, and never
on the dashboard.

## Consequences

* A message sent from a project page is always about that project and the answer lands in that project's thread.
* The one thing not built, and recorded as such on #416: project-selection BUTTONS on the Telegram question. The question
  is plain text and the person's next message names the project; whether the resolver then carries the original ask across
  is not yet proven live.
* Cross-project comparison is unchanged: while Japan is loaded, "compare this with my 2027 Financial Plan" keeps Japan
  active and reads the named project as secondary material (`app.projects_named_in`), office-scoped before the model sees it.
* ADR-0050's reasoning is kept in the code beside the pin, because it explains why the pin still exists at all.
* A future change that makes the dock keep a project the page is not on, or lets the words override a loaded project,
  reverses this decision and needs an ADR and evidence, not preference. `verify:basecamp-project-turn` (offline, 37 checks)
  and `npm run sample:dock` (the real page, as the Sample) assert it; `npm run verify:named-project` asserts the Telegram half
  including its negatives.

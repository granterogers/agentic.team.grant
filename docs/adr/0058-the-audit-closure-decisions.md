# 0058 - what the audit closure decided, and what it left to Grant

Status: accepted, 30 September 2026. Supersedes the "partial" verdict of ADR-0057 (the rows it named are now each either fixed and proven, superseded, bounded with a stated scope, or not a claim of the current product).

## The rule that closed it
A row is closed by one of: a behavioural test with a positive control and a sabotage that lands (isolated or production); a stronger mechanism that replaced it, with its evidence; a *bounded* debt - a concrete scope, a concrete failure mode, why it is confined, the mitigation, and why deferral is acceptable; or an honest statement that the current single-user product never claimed it (product or future). Nothing was relabelled "future" to close it; the triage (`docs/final-audit/FINAL-OPEN-FINDINGS-TRIAGE.md`) gives the evidence for every row.

## Decisions recorded
1. **A forwarded turn reads nothing.** `entitled` closed ten permitting readers; the task writers (complete, cancel, move, create, subtask), the file request and extraction went through `firstOf`/`firstOfHis`, which are now silent for a forwarded turn, and message pairing never joins a forwarded command to his link. The class is proven by driving every writer with a typed control (`forwarded-writers`).
2. **A machine credential is not a person asking.** An MCP client's jobs ask like any office-made root (0637): its consent is given with the office key. `output_import` left the office key's allow-list because it approves; `service-decides-nothing` derives that property from the catalog instead of matching names. A standing authorization (his press) is how a tool may proceed unasked.
3. **A question inside an approved plan is answered as itself** (0636): the job an approval starts is an action, not an asker, and a generation answer is judged by the question's recorded decline option, not by English.
4. **A turn parked for good is told to the person who asked, and Stop reaches it** (0634, 0635). There is still no "this happened / this did not" action on a step; the notice promises only what a person can do. Bounded: the step is never repeated, and there are no real occurrences.
5. **Retrieval by an agent is always one project.** A missing project means the Unnamed project, never every project; Grant's own search box is unchanged. Cross-project retrieval as a feature is decision (b).
6. **A rule is the sentence that carries the marker**, a reminder is the sentence that asked for it, and a question the writers did not take is named back when the model was not there (mixed turns, invariant 4).
7. **The dial says what it does not govern** (0633): nine external kinds run unasked and are named with reasons in `every-external-kind-is-gated-or-named.test.ts`, which fails on a tenth. Which should ask is #389/#390/#393 - not decided here.
8. **Exactly-once windows**: Google Calendar creates look up the task's own tag first, and Slack's rotated pair is stored as one statement. Provider windows that cannot be closed from this repository: Slack consumes a single-use refresh token before the reply can be stored; `tasks.sync` (dormant) has the old calendar hazard; Telegram's webhook secret proves the sender's platform, not a person (the allow-list of admitted senders is what binds identity).

## Left to Grant (not technical blockers)
(a) whether a rule or skill needs a press before it is stored; (b) cross-project retrieval as a product feature; (c) whether the dial gates starting proactive work; #389 (which of the nine ungated external kinds should ask, be standing-authorized, or stay); #390 (gateway authority setters); #393 (attachment as authority).

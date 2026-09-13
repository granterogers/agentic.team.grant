# GitHub persistence brief — 13 September 2026

**Verbatim.** Grant's instruction, stored before anything was done with it, per
CLAUDE.md's two rules: persist a requirements document the moment it arrives,
and never condense one.

The brief arrived as a standing instruction about how requirements must be
captured, and it carries its own enumerated list of the substantive
requirements it expects to survive. That enumeration is the requirement set —
it is reproduced below exactly as sent, including the example checklist.

---

CRITICAL — GITHUB IS THE DURABLE MEMORY

This entire prompt is temporary context. GitHub Issues are the durable source of truth.

Before doing any implementation, ensure that every substantive requirement, constraint, architectural decision, UX requirement, integration requirement, testing requirement, dependency, risk, non-goal, acceptance criterion, and future consideration in this prompt is persisted in GitHub.

Nothing important may exist only in this prompt, the Claude conversation, a summary, or Claude's working memory.

REQUIRED PERSISTENCE PROCESS

1. Read this entire prompt.
2. Inspect the existing repository and existing GitHub Issues.
3. For every substantive item in this prompt, determine whether it is already durably represented in:
    * an existing GitHub Issue;
    * an existing tracked specification explicitly linked from an Issue; or
    * a new GitHub Issue that you create.
4. If already represented, link the relevant existing Issue from the new parent tracking issue.
5. If only partially represented, update or create an Issue so the missing requirement is explicitly preserved.
6. If genuinely new, create an appropriate parent or child Issue.
7. Cross-link related Issues and dependencies.
8. Only after this persistence pass is complete may implementation begin.

NO INFORMATION LOSS

Do not summarize this prompt into five or six broad Issues and discard the detail.

The Issue hierarchy may group related requirements, but the complete substance must survive.

For example, requirements concerning:

* individual-agent messaging;
* whole-team messaging;
* per-project conversations;
* canonical server-side conversation history;
* Slack bidirectional synchronization;
* Telegram history/synchronization;
* loop prevention;
* cross-interface deduplication;
* message identity mapping;
* project/channel mapping;
* voice dictation;
* mobile navigation;
* mobile composer/keyboard behaviour;
* iPhone safe areas;
* Slack connection controls;
* Telegram connection controls;
* disconnected/first-run states;
* real-time updates;
* accessibility;
* search-ready history architecture;
* visual quality;
* testing;
* project isolation;
* transport failures;
* historical reconstruction;
* desktop QA;
* mobile visual QA;

must all be explicitly recoverable from GitHub after this conversation no longer exists.

They may be grouped into sensible Issues rather than one Issue per bullet, but none may be silently omitted.

COMPLETENESS CHECK

Before finishing the GitHub-planning stage, perform a requirement-to-Issue audit.

Create a checklist in the parent tracking Issue called:

Prompt Persistence Audit

It must account for every section of this prompt and point to the Issue(s) where that requirement is preserved.

Example:

[x] Canonical conversation architecture → parent + #___
[x] Direct agent messaging → #___
[x] Whole-team conversation → #___
[x] Project conversations → #___ + existing #187
[x] Slack bidirectional sync → #___
[x] Telegram history/sync → #___
[x] Voice composition → #___
[x] Mobile first-class UX → #___
[x] Connection controls → #___
[x] Real-time updates → #___
[x] Offline/first-run state → #___
[x] Accessibility → #___
[x] Search/history extensibility → #___
[x] Cross-interface equivalence tests → #___
[x] Deduplication/loop-prevention tests → #___
[x] Mobile visual QA → #___

Expand this checklist as necessary so every substantive requirement in the supplied prompt is represented.

The audit is complete only when every item has a GitHub home.

COMPRESSION-SAFETY TEST

Assume that immediately after you finish creating/updating the Issues:

this entire prompt and conversation are permanently deleted.

Ask:

Could another Claude Code session, with access only to the repository and GitHub Issues, reconstruct everything important I was asked to build, including the architectural constraints and acceptance criteria?

If the answer is no, the GitHub capture is incomplete.

Fix it before proceeding.

STANDING RULE

Whenever this prompt introduces a useful idea that should happen later rather than now, that is still a GitHub Issue/backlog requirement.

"Not implementing now" must never mean "leave it in chat."

The required lifecycle is:

idea → inspect existing work → persist in GitHub → link dependencies → prioritize → implement when appropriate

not:

idea → remember it in the Claude conversation → hope it survives compression.

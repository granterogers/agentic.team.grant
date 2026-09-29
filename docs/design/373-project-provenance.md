# #373 — a Team HQ turn says which project it came from

Branch `claude/373-project-provenance`, from `main` at `1095b04`. Written
BEFORE the fix, from the investigation below; the evidence section at the end
is filled in as it is produced.

## The lifecycle, traced

| Step | Where | Project identity |
|---|---|---|
| Grant types in a project's Chat, or in the dock | `web/studio/app.js`, `web/studio/bc/wire.js` → `chat.send(slug, …)` + `chat.ask(slug, …)` | **exists**: every caller passes the thread's project `slug`, and `PROJECTS.find(slug).id` is its UUID. The page already uses that id to read the thread back (`chat.load(slug, id)`). A portfolio message is filed under the reserved `Unnamed` project on purpose (#149) |
| Voice note | `bc/wire.js` `voiceNote()` → `/voice/note` (transcribes only) → the same `chat.send` + `chat.ask` | as for typed |
| Live call | `call.js` → `voice-token` gets `{ project: slug }` as a hint for Claire; each spoken instruction → `/voice/turn` with `{ said, session }` | the call knows the project in view (`onProject`) |
| The door | `chat.js ask()` → `POST /voice/turn` `{ said, session, to, also }` | **discarded here**: the body has no project |
| Canonicalisation | `supabase/functions/voice/index.ts` inserts `inbound_commands` with `origin_ref = session:turn` | the column `project_id` exists (0335/0337, "the project the CALLER named") and is never written, so it takes its default, `app.unnamed_project()` |
| Resolution | `app.enqueue_inbound`: asset context → **caller-named project** → Slack channel map → **conversation memory** (`app.current_project(scope, talk)`, 0547) → Unnamed | with no caller project, a Team HQ turn falls to memory or to Unnamed |
| Conversation | the conversation is `split_part(origin_ref, ':', 1)`: `conversation_before`, the #374 spoken-answer lookup, pairing, `owed_a_word` and the memory step all key on it | **the Team HQ session is one per page visit and spans every project**, so a turn in B reads A's turn as "the previous turn", and memory carries A into a message sent from Unnamed |
| Delegation | `app.enqueue_child`: `coalesce(p_project, v_parent.project_id)` | inherited correctly once the parent is right |
| The answer | Slack and Telegram delivery by the job; the dashboard thread is `conversation_history(p_project_id)` | follows `jobs.project_id`, so a wrong resolution puts the answer in another project's Chat |

**Telegram and Slack** never pass through the voice door. Telegram has no
project context. Slack's comes from the channel map. Neither is touched.

## Root cause

Two defects in one adapter, `supabase/functions/voice/index.ts`, fed by
`chat.js`/`call.js`:

1. **The project the page is showing is never sent**, so the canonical slot
   built for it (0337) is always empty.
2. **The conversation key is the page session**, which is not a conversation:
   one visit spans every project. Even with (1) fixed, a turn in B would see
   A's turn as its predecessor. That turn is what the #374 binding, the
   spoken-answer lookup, pairing and `conversation_before` consult, and memory
   would carry A into anything filed under Unnamed.

## Design

The page states the thread's project by **id**. The adapter translates it
into the two places the canonical layer already reads, and decides nothing:

- `inbound_commands.project_id` = the stated project. This is 0337's slot, and
  it outranks memory and every guess.
- `origin_ref` = `<session>/<project>:<turn>`. A Team HQ conversation is ONE
  PROJECT'S thread on one page visit. Every reader of the conversation key is
  project-scoped as a consequence, with no reader changed.

`dedupe_key` stays `voice:turn:<session>.<turn>`. Containment (0598) reads the
session from it and must keep seeing the page's shape.

**No migration.** The column, its foreign key and the resolution order already
exist.

## Invariants

1. A turn that states a project is resolved to that project and no other,
   whatever the text says and whatever was said before.
2. The same words from A and from B become two commands, on A and on B, in two
   conversations.
3. Interleaved A1 → B1 → A2 → B2 resolve A, B, A, B, and A2's previous turn is
   A1.
4. A turn stating Unnamed is filed under Unnamed even after a turn on A in the
   same visit. Memory is per project conversation, so it has nothing to
   inherit.
5. A turn that states nothing (an old page, a probe, Telegram, Slack) behaves
   exactly as today.
6. A malformed project is never sent. A well-formed id that names no project
   is dropped honestly (a retry without it, as the door already does for an
   unknown addressee): the message is kept, and the project is not guessed.
   The turn keeps its thread's conversation key (`<session>/<id>`), so it can
   never join the visit's no-project conversation and answer a question there.
7. Provenance is in the row, not in process memory. A retry, a restart or a
   delayed worker reads the same command.
8. Delegated work inherits the resolved project; this is unchanged.
9. An answer is read back by the project it was resolved to, so it can appear
   only in that project's Chat, whichever project is open.

## Rejected

- Deriving the project from the displayed name, the most recently viewed
  project, earlier messages, or any global "current project": all of these
  guess.
- A new column: `project_id` is already the caller's slot, and the per-project
  conversation key makes "Unnamed stated" distinguishable from "nothing
  stated" without one.
- Changing `enqueue_inbound` or the readers: every reader is already correct
  once the command is.
- Sending the slug: the id is canonical, and a slug would make the adapter
  look something up.

## Multi-user

The office has one owner, and every project belongs to it (`office_member`
gates sign-in, not projects). There is no cross-user project boundary to
enforce today. The invariant a future multi-user office needs is in the
design already: the project is a claim the page makes and the office
validates, never a fact the adapter trusts.

## Evidence (28 September 2026)

All of it was run on the isolated replica and a fake office, with production
credentials stripped from the environment (`safe.sh`). Nothing was deployed.

**Backend: the real `/voice/turn` door on the replica**
(`scripts/isolated/project-provenance.ts`, now in `run-all.sh`).

- Before the fix: **7/15**.
- After the fix: **16/16** (one precondition was added, see below).

**Frontend: the real page in Chromium**
(`npm run verify:basecamp-project-turn`).

- Before the fix: **3/10**.
- After the fix: **10/10**.
- It covers typed A/B with the same words, interleaved A B A B on one visit,
  the dock, a voice note, a retry after a 502, and two tabs.

**Sabotage.** Every control goes red when the part it protects is removed, and
is green again once the part is restored.

| Removed | Result |
|---|---|
| `project` in the page's body | frontend 3/10 |
| the per-project conversation key | backend 11/16 (invariants 2, 3, 4, 6) |
| the `project_id` write | backend 9/16 (1, 3, 4, 7, 8, 9) |
| the foreign-key retry | backend 15/16 (6: status 503, the message lost) |

**Two harness defects were found on the way. Both were fixed in the harness,
not the product.**

1. **Invariant 4 was vacuous at first.** The A turn before the Unnamed turn
   was answered directly by `voice_answer`. It never reached
   `enqueue_inbound`, so the conversation had nothing to remember, and
   invariant 4 stayed green even with the talk key sabotaged. The fix: the A
   turn is now work, and the check asserts that as a precondition.
2. **"The dock on the portfolio states Unnamed" was the wrong expectation.**
   A dock left open while navigating goes on showing the previous project's
   thread: its header and its voice note name that project. So stating that
   project is the page saying what is on screen, not a guess. The check now
   reads what the dock shows *before* sending. The portfolio draws no dock
   button of its own.

**Readers of the conversation key, checked.** All of them become
project-scoped, and none needed a change:

- `conversation_before`
- the #374 spoken-answer lookup
- memory (0547)
- 0556's obligation key: the same request in A and in B is now two
  obligations, which is correct
- 0571's `owed_a_word`: the voice destination is only a label, because the
  dashboard reads answers by project

Containment still reads the page's session from the `dedupe_key`, which is
unchanged (`check:voice-sessions` passes, containment is 17/17).

**Regression**, all green:

- lint, typecheck, `check:templates`, `check:secrets`,
  `check:voice-sessions`, `smoke`, `verify:wired`
- `npm test`: 3562/3562 assertions. One file cannot load without production
  credentials, which `safe.sh` strips on purpose.
- basecamp: chat 30, voicenote 48, voice-session 6, stale-answer 8,
  failures 50, voice 16, journey 56, states 80, home 45, routes 64,
  torture 31
- isolated `run-all.sh`: every proof passes

**Found and not fixed here (out of scope):** after a send from a stale dock,
the dock repaints to the current route's thread (Unnamed). The message was
filed correctly, under the project the dock showed, but it then disappears
from view. This is pre-existing and is filed separately.

**Not yet validated in production.** That needs `deploy:voice` and
`deploy:hq`. Both are for Grant to authorise.

## Adversarial review (29 September 2026)

**A cross-project authorization defect on `main`, closed by this branch.**
With the session-wide conversation key, a "yes please" typed in project B's
Chat answered a question raised in project A on the same page visit - the
#374 spoken-answer lookup (`ours`) scopes by conversation, and the
conversation spanned every project. Driven with the real door and the real
`office.instruction` handler (invariant 10 in `project-provenance.ts`):
with this branch B's reply leaves A's question open and A's reply resolves
it; with the old key restored, B's reply RESOLVES A's question.

**Found and fixed in this branch's own first version.** A stated id the
foreign key refuses (a stale tab on a deleted project) fell back to the bare
session key, which is the visit's no-project conversation. The conversation
key now stays the thread the page showed and only the filing is dropped.
The previous door fails the new check (18/19).

**Checked and sound:**

- every database reader of a voice `origin_ref` keys on the first segment
  (`split_part(..., ':', 1)`); none parses the session's shape;
- the live call fixes its project when it starts (`callAbout`, §8), so a call
  is one conversation;
- a turn sent on A and left mid-flight is stated as A, B's Chat never shows
  it, and A's Chat has the words and the answer (browser case 6);
- #376 is not a provenance flaw: the dock's header, its voice note and its
  send handler all read the same `p` from one paint, so what is stated is
  what was on screen by construction, and the browser check reads what the
  dock showed before sending;
- authority: the door requires the office's one bearer token, whose holder
  can already do everything the office can, so stating a project grants
  nothing new. A multi-user office would need the project validated against
  the caller (see Multi-user).

Backend proof 16/16 -> **19/19**; browser 10/10 -> **13/13**.

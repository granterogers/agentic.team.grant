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

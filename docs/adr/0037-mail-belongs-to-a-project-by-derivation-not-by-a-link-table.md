# ADR-0037 — Mail belongs to a project by derivation, not by a link table

**Status:** accepted · 2026-09-17 · Issue #172 · migration 0432

## Context

#172 asks the office to answer questions from Grant's correspondence, and asks
for this decision **before the first write**, because his mail is the most
personal corpus the office would hold and the one place where a retrieval bug
leaks something between contexts rather than merely being wrong.

The Issue also names the constraint that decides the shape:

> *"A dashboard project is the source of truth. Mail is something a project is
> attached to, never the project itself. The association belongs in
> `project_attachments` or `relations` — do not invent a third linking model."*

Neither of those can hold it as it stands. `project_attachments` describes a
CONNECTOR a project reads from — one row per Drive folder or Notion database,
not one per message. `relations` endpoints are uuids of typed rows and its
`from_kind` / `to_kind` CHECK lists seven kinds; `mail_messages` is keyed by
Gmail's text `message_id` and has no uuid at all. Widening both the kind list
and the key type to admit mail would be inventing the third model with two
existing tables' names on it.

## Decision

**The association is DERIVED, and nothing stores it.**

0310's rule, which this repository has already paid for twice: do not store a
fact you can already read. A message belongs to a project when one of two
things Grant already curates says so.

| Tier | The signal | Why it is trustworthy |
|---|---|---|
| `contact` | the correspondent is a `public.contacts` row on that project | Grant put that person on that project himself; it is the strongest statement of relevance the database holds |
| `named` | a `project_aliases` phrase for that project appears in the message **subject** | the same vocabulary that routes his instructions, curated by him, and already the thing `resolve_project_by_name` trusts |

Three deliberate narrowings, each of which is the difference between a feature
and a leak:

1. **The subject only, never the excerpt.** An excerpt is a hundred characters
   of whatever Gmail chose, including quoted signatures and unsubscribe
   footers. Matching there is how a personal email arrives under a work
   project.
2. **A whole phrase, at least four characters.** A substring match on a short
   alias claims the inbox. The phrase must appear whole and on word
   boundaries, so an alias of "AI" cannot match "email".
3. **Active, non-fixture projects only.** There are 1,102 alias rows across 917
   projects and almost all of those projects are retired probes. A phrase held
   by a dead fixture must never be able to claim a real message.

**Each row says which tier it came from, and the two are never merged.** A
contact match is a fact; a subject match is an inference, and an answer built
on one should be able to say so. This is 0304's asymmetry again: collapsing two
signals of different strength into one boolean is how the weaker one starts
being cited as the stronger.

**The reader is project-scoped and there is no cross-project reader.**
`app.mail_for_project` takes a project and cannot be called without one. This
is the opposite of ADR-0036's decision about decisions, and deliberately so: a
decision is a sentence the office wrote about how it works and there is one
office; a message is correspondence between two people about one piece of work.
`app.mail_recent` — the global reader that already existed — is unchanged and
stays what the office uses to answer "what has come in", which is a question
about Grant's inbox rather than about a project.

## What is cached, and what is not

Worth stating because it is better than the Issue feared and the reason is
already in the code. `src/google/mail.ts` fetches `format=metadata` with named
headers, so **the body is never transferred, never held in memory and cannot
reach a row by accident**. What `mail_messages` holds is the subject, the
sender's name and address, a recipient COUNT rather than the recipients, the
time, Gmail's own snippet, the labels, and two booleans.

So the retrieval surface this ADR opens is: a subject line, a sender, a date
and roughly a hundred characters. That is a real disclosure and it is a
bounded one, and no part of this decision needs revisiting unless the cache
ever gains a body — at which point it does, completely.

**Retention.** Nothing prunes `mail_messages`. The refresh caps at fifty
messages per run and marks anything that left the window `vanished_at`, so the
table grows slowly and for ever, and today holds ten days. A cache that holds
Grant's subject lines indefinitely is not what anybody decided; it is what
nobody decided. 0432 adds `app.forget_mail_before(cutoff)` and the duty prunes
at **180 days**, which is long enough for "have we already discussed this" and
short enough to be a limit rather than an archive.

**Nothing reaches Slack that did not reach Slack before.** This ADR adds no
delivery path. An answer citing correspondence goes wherever the job it belongs
to already goes, and `telegram.only_chief_speaks` and the channel preferences
are unchanged. The one thing to watch, recorded here so it is not discovered
later: a project with a Slack channel other people can read is a project whose
answers can quote a subject line. That is a property of answering from mail at
all, not of this mechanism, and the tier label is what lets a future handler
decline to quote a `named` match in a shared channel.

## Consequences

- **Attaching a contact to a project immediately makes their correspondence
  findable**, with nothing to backfill and nothing to maintain. That is #257's
  principle — project association implies discoverable project knowledge —
  reaching a corpus it had never reached.
- **There are zero contacts in the database today**, so the strong tier
  currently returns nothing and the whole feature rests on subject matching
  until Grant adds one. Said plainly rather than discovered: the mechanism is
  right and its best signal is unused.
- A mis-association is **visible and self-correcting**: the row names the alias
  that matched, and the fix is to rename the project or drop the alias, both of
  which Grant can already do.
- `app.project_knowledge` gains mail as a domain, so the office can say *"the
  mail has not been read"* honestly rather than reporting an absence — #257's
  rule applied to a corpus it did not know about.

## Alternatives rejected

- **A `project_mail` link table.** The third linking model the Issue forbids,
  and the copy is the one that rots: a message re-associated by a renamed
  project would need a backfill nobody would run.
- **Widening `relations` to admit a mail kind.** Needs a uuid `mail_messages`
  does not have and a CHECK widened for one caller. 0311 was a migration spent
  undoing two words for one thing; this would be two keys for one edge.
- **Matching on the excerpt as well, with a lower score.** Tempting, and it is
  the change that would make the feature look better on a demo and leak on a
  Tuesday. Rejected by rule 1 above rather than by tuning.
- **A model deciding which project a message belongs to.** Expensive per
  message, unreproducible, and unanswerable when Grant asks why something was
  filed where it was. The curated vocabulary already exists and he owns it.

# Starting a fresh session, cheaply

**Why this file exists.** Every session so far has spent its first several
thousand tokens rediscovering the same facts: which credentials are alive, what
the branch is, what is already proven. That work is deterministic, so it belongs
in scripts and in this page rather than in a conversation. Read this, run four
commands, and start work.

**Written:** 2026-09-06, the morning after the Google account was reinstated.
**Last verified:** 2026-09-07, after the approval gate and the voice work.

---

## The four commands

Run them in this order. Nothing below needs a decision from Grant.

```bash
npm ci                    # ~40s
npm run setup:python      # two pip packages: the NotebookLM adapter and faster-whisper
npm run check:secrets     # must print clean; if it does not, stop and read it
npm run inventory         # which credentials are alive, and whose account each is on
npm run verify:db         # the full live suite, ~30 minutes, 454 checks
```

`npm run inventory` is the one that replaces conversation. It probes every
credential against its real provider and prints a table with an owner column, so
"is Gemini working" and "who owns the Groq account" are answered by a script
rather than by asking. `npm test` (725 unit tests, no network) is the fast
signal when you only touched pure code.

Two scripts exist to use the system rather than test it: `npm run ask -- "…"`
runs a real question through routing, inference, review and both surfaces, and
`npm run search -- "…"` searches the corpus. Neither cleans up after itself,
which is the point — the verification suites do, and that is why the workspace
looked empty after fifteen green runs.

If `verify:db` is too slow to sit through, the individual suites are
`verify:slack`, `verify:telegram`, `verify:hq`, `verify:knowledge`,
`verify:notion`, `verify:chaos`, `verify:cross-interface`, `verify:schema` and
the rest — same names as the things they check. `npm run verify:db` runs all
twenty in order.

---

## What the environment needs

The repository is cloud-first and holds no secrets. Everything is either in the
Supabase Vault or in the session's environment. A new environment needs exactly
two variables set before any script works:

| variable | what it is |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | a Supabase **personal access token** (`sbp_…`). Every migration and every live check goes through the Management API with it, because this environment has no raw TCP egress — see ADR-0007. |
| `SUPABASE_PROJECT_REF` | `baujwlzcziasnfhhkchg`. Defaulted in most scripts, so it is optional; set it anyway. |

Everything else — the Slack tokens, the Telegram tokens, the HQ API token, the
provider keys — lives in the vault and is read at runtime. Do not add them to
the environment; `check:secrets` exists to catch exactly that.

**One warning about the access token.** It is a credential. It must never be
echoed, printed by a script, or pasted into a chat message. A deploy script
printed the HQ token into a transcript once, which cost a rotation; that is why
`scripts/deploy/hq.ts` can no longer print and why `npm run hq:token` delivers
it over Telegram instead.

---

## Branch and state

**Branch:** `claude/phase-7-communications-kh8ow8`. Develop there, push there.

Migrations are plain SQL in `migrations/`, applied in order and recorded in
`migrations/applied.json`. `npm run migrate` applies anything unapplied; it is
idempotent, so running it in a fresh environment is safe and is the correct
first move if `verify:db` complains about a missing function.

---

## What to read, and what not to

Read, in this order: [`known-problems.md`](known-problems.md), then
[`HANDOFF.md`](HANDOFF.md), then `AI_TEAM_HQ_MASTER_SPEC.md` for whichever §
you are about to touch. Skip the dated handoffs — they are history.

Do **not** re-read the whole spec at the start of a session. It is long, it is
canonical, and it is indexed by §; look up the section the task names.

---

## The state of the Google account

Reinstated on 2026-09-05, verified rather than assumed: the NotebookLM master
token mints access tokens again and the Gemini key lists models again. Migration
0049 records this.

**The NotebookLM sync is not coming back, and that is now decided.** The appeal
reversed the penalty, not the policy: NotebookLM has no public API, so any
unattended client has to impersonate a browser session, which is what the ban
named. [ADR-0013](adr/0013-the-project-is-the-source-of-truth.md) settles what
replaces it — the project is the source of truth, knowledge tools are
connectors, and retrieval is Postgres full-text search over `public.documents`.
Notion is the registered first-class connector and waits only on a token.

---

## What is actually left

Phases 0–8 are complete. Phase 10 (hardening) is unblocked, needs nobody, and is
the obvious next move. Phase 9 must not start. The things waiting on Grant are
listed at the end of [`HANDOFF.md`](HANDOFF.md) and in `npm run inventory` —
that list lives in files precisely so it stops being drip-fed one item per turn,
which is the single worst habit of the sessions so far.

---

## Habits this codebase has had to learn the hard way

Read these before writing anything. Each one cost a defect that shipped, and
they are listed here rather than in a style guide because every one of them was
already obvious in principle to whoever broke it.

1. **A mechanism is not finished until something calls it.** `processCallbacks`
   was written, tested six ways and called by nothing outside its own tests, so
   no button in Slack or Telegram had ever done anything. `inbound_commands` had
   a writer and no reader for text. Both were complete except at the point where
   they met the rest of the system. When you add a module, grep for its name
   outside `tests/` before you call it done.

2. **A list that exists twice will drift.** The button vocabulary lives in
   `ACTIONS`, in a Telegram map, and in a check constraint; the constraint fell
   behind twice, each time surfacing as a 503 that Telegram retried forever. If
   a list must be duplicated into SQL, add a live check that inserts every value
   — `verify:slack` does this now.

3. **Walk the parent chain.** A follow-up job is the same person continuing the
   same work. Who is speaking, where to reply, which approval is open — every
   one of those lookups was written against the job in hand, and every one of
   them was wrong for a child job. Three separate fixes before it was written
   down.

4. **Read the library, do not infer it.** A private table of NotebookLM's status
   integers read "in progress" as "finished". The library exposes `is_completed`
   and says in as many words that the integers must not be read directly,
   because two of them were transposed on the wire in an earlier release.

5. **Measure the rule against the real document.** A boilerplate stripper based
   on "menus are runs of short lines" wanted to delete two thirds of the actual
   article, because that extractor hard-wraps prose too. Its own guard caught
   it. Write the guard first.

6. **Say what you could not do.** A guard that silently returns "nothing
   happened" makes "nothing matched" and "everything matched and was overruled"
   the same symptom. Return the reason.

7. **One message per surface.** The reply channel and the pager both write to
   Telegram; for an instruction Grant sent from Telegram they write to the same
   chat, and every job produced two identical messages. Neither channel was
   wrong — the rule above them was missing.

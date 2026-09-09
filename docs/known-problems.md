# Known problems

**Last verified: 2026-09-09.** Everything here was checked, not assumed. Where
something is unknown, it says unknown rather than guessing.

Ordered by what would hurt most. `npm run inventory` regenerates the credential
half of this live, and is the thing to trust when this file and it disagree.

Defects already found and fixed are in
[`defects-fixed.md`](defects-fixed.md), kept because the shapes recur — and
distilled into the seven habits at the end of
[`new-environment.md`](new-environment.md). Nothing there is outstanding.

---


## NotebookLM slide decks — the headline was wrong

This section said *"slide decks fail, every time"* for two sessions. Running
`npm run notebook:slides` — a read, costing nothing — took ninety seconds and
showed both halves of that claim to be false:

- **The account is offered slide decks.** `get_customization_choices` lists
  `slide_deck` with two presets. Nobody had ever called it, which is the
  embarrassing part: the question "does this tier support them at all" was
  free to answer and load-bearing for everything else.
- **The notebook contains a COMPLETED slide deck** — "The Blueprint of Trust" —
  and zero failed artifacts of any kind.

So what is true is narrower and more useful: **our two attempts failed, and
slide decks work on this account.** Google no longer holds either of the
artifacts we recorded as `failed` and `abandoned`, so they were cleaned up on
their side.

What is still unknown: why those two failed. Not enough to act on, and no
longer a reason to treat the feature as unavailable.

`artifacts.retry_failed` is now wired into `act.py` as the `retry` action — it
had been in the library all along with no caller, so a failed artifact was a
dead end whose only recovery was generating a fresh one, paying the allowance
twice and losing the instructions. It is a generation as far as the meter and
0083's approval gate are concerned, both of which sit upstream of it.

**The lesson worth keeping**: a claim in this file said "every time" on a sample
of four, and stopped anyone looking for ninety seconds' worth of evidence that
contradicted it.

## Web extractions still carry furniture

`stripBoilerplate` removes bare-URL lines, their labels and named chrome on
ingest, which took the Wikipedia article in the corpus from 69,000 characters to
27,000 and made the same search return the article's real paragraphs instead of
its navigation menu.

It is not solved. What remains still contains theme toggles, "Toggle the table
of contents", language lists and the footer. The rules only delete lines they
can name, and refuse entirely if too little would survive — both deliberate,
because §10's citations are built on the stored text being what the source said.
A real readability extractor is the fix; nobody has needed it enough yet.

## Google's notebook allowance cannot be read

Compute-based since 2 September, refreshing every five hours against a weekly
cap, and exposed only in Google's own interface. The adapter library has
`AccountLimits` — notebooks, sources, tier — and nothing about compute.

So `notebook_spend` is OUR count of OUR spending, every surface says so, and the
ceiling is learned from refusals rather than known. Do not let a figure derived
from it be presented as Google's.


## 🔴 Serious — act on these

### 1. The vault export is a manual habit, not a schedule

`npm run vault:export` now exists: it reads all twenty-two secrets, writes a
Bitwarden-format JSON, encrypts it with AES-256 and a random passphrase, and
sends the file and the passphrase as **two separate Telegram messages**. Nothing
is printed and nothing is written outside a temp directory that is removed even
on failure. First run was 2026-09-06.

That closes the acute problem — a restore no longer means re-entering
twenty-two secrets from memory — and leaves a smaller one: it runs when someone
remembers. The nightly backup still excludes `vault` and still should, so until
this is on the same schedule as the dump, a secret added on Tuesday is not in
any export until someone runs the command.

**What has to happen:** put it on the same schedule as the database backup, and
import the file Grant already has.

**Update, 2026-09-09.** The database backup itself now HAS a schedule again —
`nightly-backup`, a duty, into a private Supabase bucket, with the restore
rehearsed (`npm run backup:rehearse`, 8/8). The vault export is still the
manual half: its handler would need `openssl` replaced with Web Crypto to run
in the worker, and enabling it means a copy of every credential arriving on
Telegram weekly without anyone asking first. Built when Grant says so, not
before.

---

## Fixed 2026-09-09, second pass

Grant reported two symptoms — "a lot of repetition from one of the bots" and
"I need messages answered within a minute". They were six defects.

- **A message typed in Slack never became work.** `slack-events` stored the
  canonical command and never called `enqueue_inbound`. Thirty instructions
  over three days, filed and never answered. Telegram has made that call since
  0072 and voice since 0102. `app.enqueue_orphans` is now the floor under all
  three.

- **Slack never kicked the worker either**, so even once enqueued it waited
  for the next tick.

- **Grant was queuing behind the housekeeping.** Duties take priority 100 and
  his instructions were given 150 — and lower is sooner. Every calendar
  refresh outranked a message he was waiting on (0149).

- **The worker was phoning its own database long-distance.** Every query went
  over the Management API at ~1.5s each, so an empty pass cost 17–22 seconds.
  The edge worker runs on Supabase's own network and now connects directly;
  an empty pass is under a second. ADR-0007 still holds — it is about the
  sandbox, which still cannot do this.

  Measured, end to end through the deployed webhooks: Telegram 25.6s → 11.6s,
  Slack 72.1s → 15.8s. `npm run verify:latency`.

- **Marcus would not stop talking.** 0101 rewrote the duty dispatcher and
  changed `announce` from false to true on the way past. Handlers now say
  whether their own outcome is worth announcing; "nothing new" is silent.

- **And he was messaging the wrong place.** Every result went out on the pager
  bot, so work by any staff member arrived in Grant's private chat. The bot is
  now chosen from whoever did the work, which is what makes 0136's routing
  real.

---

## Fixed overnight, 2026-09-09

Kept here for one read, then they move to `defects-fixed.md`. All four were
found by running something end to end rather than by reading code.

- **No output had ever been attributed to anybody.** 736 of 736 outputs with a
  null `staff_id`, and 253 of 269 deliveries with no author, while §9 makes
  staff identities and §22 A requires "correct staff identity". A name was
  resolved for display and never persisted, so the author of a finding
  survived exactly as long as the Slack message did. It also silently broke
  the voice path: the query answering *"what was Research going on about?"*
  inner-joins outputs to staff.

- **The event ledger had never recorded a single action by the working
  system.** 75 events, every one written by a verification suite, none with a
  related job. §6 makes the ledger the spine; the table worked perfectly and
  nothing had ever used it.

- **§22 A's own sentence was classified as a request for work.** 0105's
  imperative phrase list contains "research", and so does the Research
  Director's title, so asking what Research had been doing was delegated back
  to the office instead of answered. Fixed in 0139 with three conditions at
  once, and 0105's own examples asserted unmoved.

- **`verify:chaos` was the one suite that drove jobs through the state machine
  by hand and the one suite that did not hold the queue still.** The
  crash-after-commit case failed at random because a heartbeat worker
  recovered the job in the gap between the fixture reaching `notifying` and
  the fixture writing its output.

---

## 🟠 Live but degraded

### 2. Two accounts can be suspended by a company that is not us

Supabase and Vercel both sign in with Google. That account was disabled on
2026-09-04 and reinstated on 2026-09-05 after an appeal — nothing went down,
because a disabled account breaks the login button and not the service, and API
tokens are independent of how you signed up.

Re-homing is therefore no longer urgent. It is still worth doing, because the
exposure is real and will be real again: an account another company can suspend
should not be the recovery path for two others. Backblaze, checked on
2026-09-06, uses the Google address as a username with **its own password** and
no SSO — so the backup, the thing that would actually hurt, was never at risk.

Procedure in [`account-continuity.md`](account-continuity.md), now a rehearsed
operation rather than an emergency plan.

### 3. `GROQ_API_KEY` returns 401

Found by `npm run inventory`; nobody knew. Grant has parked the question of
which account it belongs to, so this stays listed as dead rather than quietly
dropped — the router does not use Groq, so nothing is blocked, but a credential
in the environment that does not work is a credential something will one day
believe in.

---

## 🟡 Built but unproven

### 4. No human has ever pressed a button

Both channels' interaction paths are verified with synthetic presses through the
deployed endpoints, and the callback processor acts on them correctly. Grant has
now received real messages on both surfaces, but no real person has tapped 👍,
Undo or Mute. One tap turns the whole path from "checked" into "observed".

### 5. Team HQ has been opened but not judged

It loads for Grant, which retires the deployment question. Whether it *reads*
well on a phone — viewport, touch targets, whether the sparklines say anything
at a glance — is a subjective acceptance, and §13's Gate 1 precedent is explicit
that those are not marked passed before the human performs them.

### 6. Voice notes have never been synthesised

Everything up to the API call is built and checked (14 live checks: ledger,
budget reservation with its concurrency guarantee, six reasons to stay silent).
The Google Cloud TTS credential is **parked at Grant's request**. Without one,
every note degrades to text and says `no_credential` — the acceptance criterion
working, not a gap.

### 7. NotebookLM is back on, and the reason it was off has not changed

Restored on 2026-09-06 at Grant's instruction, with the credential verified the
same day: three notebooks, `available_unofficial`, a real sync run. Recorded in
migration 0061.

The risk is not that it stops working — it works. It is that NotebookLM has no
public API, so the client impersonates a browser session, which is the behaviour
the 2026-09-04 ban named. The appeal reversed a penalty, not a rule. What has
changed is the blast radius: everything the notebook feeds is cached in
`public.documents`, retrieval needs no external service, and nothing else
depends on the account. If it goes again it costs a route, not a corpus.

### 8. The corpus is one document

The knowledge layer is built and used — `npm run ask` retrieves before it asks,
and records what it retrieved as the output's sources. But the whole corpus is a
single cached Wikipedia article, so the retrieval is exercised rather than
useful. Notion authenticates and has nothing shared with it; three clicks in
Notion (⋯ → Connections → *Agentic Team Grant*), then `npm run notion:sync`.

---

## 🟢 Accepted limitations

- **Team HQ is read-only.** Actions need a confirmation model per §21 first, and
  a dashboard where you can do something irreversible by accident is worse than
  one where you cannot do anything.
- **One HQ token, no per-device revocation.** Rotating locks out every device.
  Fine for one user; not for two.
- **Telegram cannot reconcile an interrupted send.** A bot cannot read its own
  sent messages back, so an indeterminate send parks forever rather than risk
  sending twice. Slack can be asked; Telegram cannot. Not fixable.
- **Slack identity is cosmetic.** `chat:write.customize` gives name and avatar,
  not a mentionable user. Per-staff Slack apps were considered and deferred.
- **Two Telegram bots missing** — Quality and Comms. A staff member without one
  falls back to the pager, and there is a check that proves it. BotFather steps
  in [`telegram-bot-roster.md`](telegram-bot-roster.md).
- **A bot's profile photo cannot be set through the API.** It is BotFather only.
  Cosmetic; the office already shows these faces in Slack.
- **NotebookLM has no unattended client, permanently.** Not an outage and not a
  gap — [ADR-0013](adr/0013-the-project-is-the-source-of-truth.md) decided it.
  It has no public API, so any automation must impersonate a browser session,
  which is what got the account banned. A source can still be pasted in by hand
  and becomes a document like any other.

---

## What is NOT a problem, though it was on 2026-09-05

Kept briefly, because a resolved item that vanishes silently gets re-raised.

| Was | Now |
|---|---|
| The Google account is disabled and four vendors sign in with it | reinstated 2026-09-05, verified rather than assumed (migration 0049) |
| Backblaze may be locked out when its login window closes | it never had a Google login — own password, no SSO |
| The system has no knowledge layer and its replacement is undecided | [ADR-0013](adr/0013-the-project-is-the-source-of-truth.md) decided it and it is built: `public.documents`, a connector registry, Postgres full-text search, Notion connected |
| `GEMINI_API_KEY` is dead | works again with the account. Unused by anything — the router is OpenRouter-only |
| Ownership of the OpenRouter, OpenAI and Groq accounts is unknown | parked by Grant on 2026-09-06 |
| Six Telegram bots missing | five arrived, registered, configured and answering |

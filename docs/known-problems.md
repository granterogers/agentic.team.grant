# Known problems

**Last verified: 2026-09-06.** Everything here was checked, not assumed. Where
something is unknown, it says unknown rather than guessing.

Ordered by what would hurt most. `npm run inventory` regenerates the credential
half of this live, and is the thing to trust when this file and it disagree.

Defects already found and fixed are in
[`defects-fixed.md`](defects-fixed.md) — twenty-six of them, kept because the
shapes recur. Nothing there is outstanding.

---

## 🔴 Serious — act on these

### 1. Credentials are not in the backup

The nightly dump is `--schema=public --schema=app`. Supabase Vault lives in
`vault` and is excluded — correctly, since a backup carrying decryptable secrets
offsite would be a worse problem — but it means **a restore produces a working
database with an empty vault**, and every secret must be re-entered by hand.

There are now twenty-two of them, including six Telegram bot tokens and a Notion
token that only exists in the vault. The rehearsal prints the list every night.

**What has to happen:** copy the vault contents into a password manager. Until
that exists, the password-manager gap *is* the credential backup gap, and it is
the one thing on this page that could turn a recoverable incident into a lost
weekend.

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

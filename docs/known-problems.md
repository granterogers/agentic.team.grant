# Known problems

**Last verified: 2026-09-05.** Everything here was checked, not assumed. Where
something is unknown, it says unknown rather than guessing.

Ordered by what would hurt most. `npm run inventory` regenerates the credential
half of this live.

---

## 🔴 Serious — act on these

### 1. Four vendors sign in with a Google account that no longer exists

Google disabled `agentic.team.grant@gmail.com` on 2026-09-04 ("created or used
with multiple other accounts... might have been created by a computer program").
Deletion scheduled 2027-07-31.

| Vendor | Effect |
|---|---|
| **Backblaze B2** | holds the only offsite backup. Login still works — **this window may close** |
| **Supabase** | dashboard locked out. Project runs, tokens work |
| **Vercel** | dashboard locked out. Site serves, token works |
| **Google Cloud / Gemini** | gone with the account |

**Nothing is down.** A disabled Google account breaks the login button, not the
service, and API tokens are independent of how you signed up.

**What has to happen:** change the Backblaze account email while login still
works — password resets and 2FA recovery go to a dead mailbox, so losing that
session is permanent. Then decide whether to re-home Supabase and Vercel or
petition support. Re-homing is now a rehearsed operation; support is a hope.

See [`account-continuity.md`](account-continuity.md) and
[`adr/0012`](adr/0012-notebook-account-disabled.md).

### 2. The knowledge layer is gone and its replacement is undecided

NotebookLM authenticated as that account; the master token returns
`403 BadAuthentication`. Turned off in migration 0048 with the reason recorded.

Cost was small — 3 of 118 projects had a notebook reference, 1 source, and the
source's text was already cached in Postgres — because ADR-0003 made it a
replaceable adapter. But the system currently has **no knowledge layer at all**.

Recommendation in ADR-0012: Postgres full-text search first, pgvector only if
that proves insufficient. **Decision is Grant's and is open.**

### 3. Credentials are not in the backup

The nightly dump is `--schema=public --schema=app`. Supabase Vault lives in
`vault` and is excluded — correctly, since a backup carrying decryptable secrets
offsite would be a worse problem — but it means **a restore produces a working
database with an empty vault**, and every secret must be re-entered by hand.

The rehearsal now prints the list every night. Until the vault is copied into a
password manager, that password manager gap *is* the credential backup gap.

---

## 🟠 Live but degraded

### 4. Two credentials are dead and one is misleading

| | State | Action |
|---|---|---|
| `GROQ_API_KEY` | **401** — found by `npm run inventory`, nobody knew | regenerate, or drop Groq from the router |
| `GEMINI_API_KEY` | dead with the account | **delete the variable** — it is present, so anything testing `if (key)` believes it has a credential |
| `SLACK_APP_CONFIG_TOKEN` | expires every ~12h by design | `npm run slack:rotate` |

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are valid but belong to a project
under the dead account. **Assume dead** until proven otherwise. They are Phase
9's foundation, which is why Phase 9 should wait.

### 5. Ownership of three accounts is unknown

OpenRouter, OpenAI and Groq. Each is one question — which email? — and any on
the dead account needs re-homing before it dies too.

---

## 🟡 Built but unproven

### 6. No human has ever pressed a button

Both channels' interaction paths are verified with synthetic presses through the
deployed endpoints, and the callback processor acts on them correctly. But no
real person has tapped 👍, Undo or Mute. One tap turns the whole path from
"checked" into "observed".

### 7. Team HQ has never been judged on a phone

Viewport, touch targets and mobile-first CSS are checked. Whether it *reads*
well is not, and §13's Gate 1 precedent is explicit that a subjective acceptance
is not marked passed before the human performs it.

### 8. Voice notes have never been synthesised

Everything up to the API call is built and checked (14 live checks: ledger,
budget reservation with its concurrency guarantee, six reasons to stay silent).
Without a Google credential every note degrades to text and says
`no_credential` — the acceptance criterion working, not a gap.

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
- **Six Telegram bots missing.** Roster and BotFather steps in
  [`telegram-bot-roster.md`](telegram-bot-roster.md).

---

## Fixed today, recorded so they are not re-introduced

| | |
|---|---|
| The backup rehearsal had **never passed** — 12 runs, 12 failures, silently | vault stand-in in the rehearsal target; **now pages Grant on failure** |
| A test left a **global mute** that suppressed every routine notification for 3 days | migration 0036; gate-3 cleans up after itself; the suite clears its own |
| The worker moved jobs to `complete` with reason "delivered" while **delivering nothing** | a real notifier; the state reason now reports every channel's actual outcome |
| A 👍 was attributed to **the wrong output** — resolved by correlation, which spans jobs | migration 0037: deliveries record the job |
| Six **dead buttons** — the composer invented a wire format the adapter never parsed | both sides now tested against each other |
| A correlation written into a column with a **foreign key to `events`** | left null; the work is resolved from the message instead |
| The HQ deploy script **printed its token into a transcript** | rotated; the script can no longer print it — `npm run hq:token` sends it to Telegram |
| `verify:credentials` **broke the live Slack install every run**: it upserted the production row with its probe secret reference, then deleted that secret at cleanup. Nothing failed until `slack:rotate` refused, days later | the lifecycle checks run against a probe row (`A0PROBELIFE`) and never touch the install; a 19th check fails the suite if any reference is DANGLING; `npm run slack:repair-refs` repairs one |

Full accounts, with the reasoning, in [`test-evidence/`](test-evidence/).

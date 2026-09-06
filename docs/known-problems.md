# Known problems

**Last verified: 2026-09-06.** Everything here was checked, not assumed. Where
something is unknown, it says unknown rather than guessing.

Ordered by what would hurt most. `npm run inventory` regenerates the credential
half of this live.

---

## 🔴 Serious — act on these

### 1. Four vendors sign in with a Google account that no longer exists

Google disabled `agentic.team.grant@gmail.com` on 2026-09-04 and **reinstated
it on 2026-09-05** after an appeal (migration 0049; verified, not assumed — the
NotebookLM token mints again and the Gemini key lists models again).

**Everything held.** A disabled Google account breaks the login button, not the
service, and API tokens are independent of how you signed up. What the week
actually cost was an audit, and the audit's findings are the rows below.

| Vendor | Where it stands |
|---|---|
| **Backblaze B2** | ✅ **safe.** Registered to the Google address but with its own password — no Google SSO, so a Google suspension cannot lock it. Confirmed 2026-09-06 |
| **Supabase** | dashboard access restored with the account |
| **Vercel** | dashboard access restored with the account |
| **Google Cloud / Gemini** | back, and the Gemini key works |

**The lesson stands even though the penalty was reversed.** The appeal did not
change the policy: NotebookLM has no public API, so any unattended client has
to impersonate a browser session, which is what the ban named.
[ADR-0013](adr/0013-the-project-is-the-source-of-truth.md) settles what replaces
it — the project is the source of truth, knowledge tools are connectors, and
Notion (official API, OAuth, no policy exposure) is the first-class one.

See [`account-continuity.md`](account-continuity.md), which is now a rehearsed
re-homing procedure rather than an emergency plan, and
[`adr/0013`](adr/0013-the-project-is-the-source-of-truth.md).

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
| `npm run inventory` reported the Slack config token dead **minutes after a successful rotation** — it probed the environment copy, which rotation never updates | it resolves the token from the vault, where rotation writes it |
| Slack channels were named `proj-<slug>` — unambiguous, and in Grant's words "a bit strange". A sidebar is read by a person | plain English from the project's name: `#ai-team-hq-test`. `slack:rename-channels` migrates the ones that already exist |
| The Chief of Staff bot token lived **only in an environment variable**, against §15, so three senders each needed it in their own environment | it is in the vault, the registry (0054) holds its identity, and `ask`, `hq:token` and the backup pager all resolve it from there |
| 0054 seeded the pager's username from the roster document (`atg_chief_bot`) rather than from `getMe`. The real one is `@agenticteamgrantbot` — a registry naming a bot nobody can open is worse than one with no name | 0055; the roster records an intention, the API records a fact |
| `slack_channel_map` claimed nine channels were live that Slack had archived — every run whose cleanup was interrupted left one. A mapping that names an archived destination is worse than none | the rename script reconciles against Slack, which is the authority on archived |
| A **channel with only the bot in it**: the office provisioned its first real project channel, posted into it, and Grant saw nothing. 56 Slack checks passed because each asks whether the message arrived, none whether it arrived to anyone | the provisioner invites the human (0050); a 57th check reads the membership back |
| The intent classifier could not read a **bare imperative** — "Research X", "Draft Y" matched no rule and fell through to an unconfident `thought`, which convenes nobody | a `bare-imperative` signal at `light_investigation`, with a CONTROL for the same verbs used as nouns |
| Renaming `notebook_sources` broke `app.project_attention()` and surfaced as a **502 from Team HQ**: a function body is stored as text, so it does not follow a rename the way a view does | 0053 recreates it; `verify:schema` now fails on any function naming a relation that does not exist, and was itself proven to discriminate |
| 0051 made the uniqueness index partial for uploads but left the columns `not null`, so the case the index was written for **could not be inserted at all** | 0052; found by `verify:knowledge` on its first run |
| The same partial index then broke the sync's `on conflict` target — one run stored **zero rows** and said nothing | the conflict target carries the index predicate |

Full accounts, with the reasoning, in [`test-evidence/`](test-evidence/).

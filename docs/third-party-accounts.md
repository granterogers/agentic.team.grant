# Every third-party account this project depends on

**Purpose:** one page, so changing the sign-in email is a task with an end,
rather than a discovery process.

**Compiled 2026-09-05** by sweeping every external host called from `src/`,
`scripts/` and `supabase/`, every environment variable, every vault secret,
every GitHub Actions secret, and every vendor named in the architecture
documents. Where I know something I say how I know it; where I do not, it says
unknown rather than guessing.

**Updated 2026-09-06:** the Google account was reinstated, and Backblaze turned
out never to have used Google sign-in. Nothing here is urgent any more. It is
kept because the exposure is structural: an account another company can suspend
should not be the recovery path for the accounts beneath it.

Legend: ✅ safe · ⚠️ signs in with Google (reinstated, still a dependency) ·
❓ unknown · ⛔ dead

---

## Tier 1 — the system stops without these

| | Service | What it does here | Sign-in | How I know |
|---|---|---|---|---|
| ✅ | **Backblaze B2** | the **only** offsite backup of the database | Google address, **its own password — no Google SSO** | confirmed by Grant 2026-09-06 |
| ⚠️ | **Supabase** | Postgres, Edge Functions, the vault, avatar storage — the system itself | ⚠️ Google sign-in (reinstated) | you told me |
| ⚠️ | **Vercel** | hosts Team HQ and the voice page | ⚠️ Google sign-in (reinstated) | **confirmed** — the API returns `agentic.team.grant@gmail.com` |
| ✅ | **GitHub** | the code, and Actions runs backups, CI, sync and Slack token rotation | ✅ `granterogers` | confirmed from the remote and run history |
| ✅ | **Slack** | the office surface | ✅ primary owner `grant.e.rogers` | confirmed via API; email not exposed to the bot |
| ✅ | **Telegram** | the pager surface | ✅ your phone number | BotFather is bound to the phone, not an email |
| ✅ | **Notion** | the first-class knowledge connector (ADR-0013) | ✅ `Grant Rogers's Space` | integration token verified against the API 2026-09-06 |
| ❓ | **OpenRouter** | the primary inference router — all free-model work | ❓ unknown, **parked** by Grant 2026-09-06 | key works, 5 credits |
| ❓ | **OpenAI** | avatar image generation; available as a fallback | ❓ unknown, **parked** | key works |
| ⛔ | **Groq** | secondary inference — **unused; the router is OpenRouter-only** | ❓ unknown, **parked** — and the key is dead (401) | `npm run inventory` |
| ✅ | **Google** | Gemini API, Cloud project, OAuth client. NotebookLM is retired for good by ADR-0013 | ⚠️ disabled 2026-09-04, **reinstated 2026-09-05** | verified: the token mints and the key lists models |

**Superseded on 2026-09-05:** the Google account was reinstated, and on
2026-09-06 Backblaze turned out never to have been at risk — it uses the Google
address as a username with its own password, not Google sign-in. The re-homing
work below is no longer urgent. It is kept because the exposure it describes is
real and will be real again: an account that can be suspended by one vendor
should not be the recovery path for five others.

**Original order to work through:** Backblaze first — its login window may close and it
holds the only backup. Then the three unknowns, because an unknown on the dead
account is a Backblaze waiting to happen. Supabase and Vercel are safe to leave
running while you decide between changing the email and re-homing.

---

## Tier 2 — you may have signed up and forgotten

None of these have credentials in this project and none are called at runtime.
They appear in the architecture and research documents as options that were
evaluated. **If you created an account while evaluating, it is probably on the
Gmail too.**

| Service | Why it appears | Likely signed up? |
|---|---|---|
| **Cloudflare** | The architecture doc names **R2 for backups** and **Workers Cron for scheduling** — both later replaced by Backblaze and GitHub Actions. Named 14 times | **Quite possibly. Worth checking first of this group** |
| Netlify, Railway, Render, Fly.io | evaluated as hosting, all rejected in favour of Vercel + Supabase | possible |
| Hetzner, Oracle Cloud | evaluated as always-on VMs, rejected — the sync is pure HTTP | possible |
| Together, Cerebras, SambaNova, Cohere, HuggingFace | evaluated as free-inference providers, not adopted | possible |
| ElevenLabs, Deepgram, Cartesia | evaluated for voice, rejected for Chirp 3 | possible |

I cannot check these — no credentials, nothing to probe. Search your password
manager and your Gmail for sign-up confirmations, though note the mailbox is
disabled, so the password manager is the better search.

---

## Tier 3 — worth a thought

| | |
|---|---|
| **Anthropic / Claude Code** | this session. Which email is the subscription on? If it is the Gmail, that is how you lose the ability to work on this at all |
| **Apple / Google Play** | not used — the voice interface is a web page, deliberately (ADR-0006, no native app) |
| **Domain registrar** | none. Everything is on `*.vercel.app` and `*.supabase.co` subdomains |
| **npm** | no account needed; the project publishes nothing |

---

## While you are in each account, three things beyond the email

Changing the sign-in address is necessary and not sufficient:

1. **The recovery email is a separate field** on most services and often still
   points at the old address. Vercel, Supabase and Backblaze all have one.
2. **2FA recovery.** If backup codes were emailed to the dead mailbox, generate
   new ones. If 2FA is an authenticator app, you are fine.
3. **Billing contact.** Dunning emails to a dead mailbox mean a card expiry
   becomes a silent suspension. Backblaze is the one that would hurt.

---

## Environment cleanup, once you have re-homed

Two variables in the session environment are dead and should be removed —
present-but-dead is worse than absent, because code testing `if (key)` believes
it has a credential:

- `GEMINI_API_KEY` — bound to the disabled account
- `NOTEBOOK_COOKIES` — 8,250 characters of session cookies from the disabled
  account. Dead, and the ones printed to a transcript earlier in the week

`npm run inventory` reports the live state of everything above at any time. It
is generated rather than stored, so unlike this document it cannot go stale —
this page is the map, the command is the territory.

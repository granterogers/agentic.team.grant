# Account continuity after the Google ban

**Date:** 2026-09-05 · **Trigger:** `agentic.team.grant@gmail.com` disabled by
Google on 2026-09-04, deletion scheduled 2027-07-31.

Supabase and Vercel were signed up with that Google account. This is what that
does and does not mean, checked rather than assumed.

---

## Nothing is down

| | |
|---|---|
| Supabase project | `ACTIVE_HEALTHY`, verified today |
| Management API token | works |
| Service role key | works |
| Vercel deployment | serving, verified today |
| Vercel token | works |
| Slack, Telegram, Team HQ, the worker | all verified today |

**A disabled Google account breaks the login button, not the service.** API
tokens are independent of how you signed up, and they do not expire on their
own. The system keeps running.

The exposure is **account control**, not data loss, and not an outage.

---

## What each service is actually tied to

| Service | Account | At risk? | If access is lost |
|---|---|---|---|
| **GitHub** (source of truth for code) | `granterogers` | ✅ safe | — |
| **Slack** | primary owner `grant.e.rogers` | ✅ safe | — |
| **Telegram** | Grant's phone number | ✅ safe | — |
| **Backblaze B2** (the backups) | ❓ **unknown — needs checking** | ? | see below |
| **Supabase** | dead Google account | ⚠️ dashboard only | project runs; no settings, no billing, no new keys |
| **Vercel** | dead Google account (`agentic.team.grant@gmail.com`, confirmed) | ⚠️ dashboard only | site serves; no domain or project changes |
| OpenRouter / Groq / OpenAI | unknown, keys work | ? | inference stops if a key is lost |

**The one question that matters most: which email is Backblaze B2 under?**
Everything else has either a safe owner or a recoverable credential. B2 holds the
only offsite copy of the database.

---

## The data is safe, and this is why

Offsite backups are running and current, verified today by listing the bucket:

```
2026-09-03  34KB   aiteamhq-20260903T111157Z.sql.gz
2026-09-04  180KB  aiteamhq-20260904T080141Z.sql.gz
2026-09-05  259KB  aiteamhq-20260905T074242Z.sql.gz   ← this morning
```

Each with a `.sha256`, a `manifest.json` and `roles.sql`. They run from GitHub
Actions — a different account — to Backblaze — a different provider. Neither
touches Google.

And per §16 the workflow does not just dump: **it rehearses the restore on the
same schedule**, which is why the next section is a procedure rather than a
hope.

---

## Re-homing is a rehearsed operation, not a leap

This is the part worth understanding. Moving the Supabase project to a new
account is *exactly* the restore that runs every night and is tested every
night:

1. Create a new Supabase project on a live email.
2. Restore the latest dump into it (`roles.sql`, then the `.sql.gz`) — the same
   two steps the rehearsal performs.
3. Update `SUPABASE_URL`, the keys, and `SUPABASE_PROJECT_REF`.
4. Re-deploy the three Edge Functions (`npm run deploy:slack`,
   `deploy:telegram`, `deploy:hq`) — each is one command and each verifies
   itself by what it serves.

Vercel is simpler still: `npm run deploy:hq` against a new account, and the
stable URL changes.

**This is what §16 bought.** A nightly dump nobody had ever restored would make
the paragraph above a gamble. A nightly dump with a nightly restore rehearsal
makes it a checklist.

---

## The credentials, by whether losing the account would matter

Everything lives in the Supabase vault, which sounds like a single point of
failure. Going through it one at a time, mostly it is not:

| Secret | Regenerable from | Depends on a dead account? |
|---|---|---|
| `slack.signing_secret` | api.slack.com | no — Slack is safe |
| `slack.config_token` / `refresh` | api.slack.com | no |
| `telegram.webhook_secret` | ours; regenerate at will | no |
| `hq.api_token` | ours; `deploy:hq --rotate-token` | no |
| `supabase.db_password` | resettable via the Management API, which works | no |
| `notebook.master_token_json` / `storage_state` | — | already dead, already retired |
| **`backup.s3_*` (Backblaze)** | the B2 dashboard | **only if B2 is under the dead email** |

So the practical answer: **one credential pair is genuinely at risk, and only if
Backblaze was signed up with that Gmail.**

---

## What to do, in order

1. **Check which email Backblaze B2 is under.** If it is the dead one, create B2
   keys on a live account today and update the vault — while the current keys
   still work to migrate anything needed.
2. **Copy the vault into a password manager**, once, by hand. Not because it is
   likely to be lost, but because it costs ten minutes and removes the whole
   category of worry.
3. **Decide: re-home, or fight for the accounts.** Supabase and Vercel support
   can change an account's email with proof of ownership, and that is worth an
   email. But it depends on them replying, and re-homing does not. Given that
   the restore is rehearsed nightly, I would re-home and treat any support reply
   as a bonus.
4. **Appeal the Google ban** anyway. Free, and if it succeeds the Cloud project
   and its OAuth client come back.
5. **Do not create another Google account** for any of this. See ADR-0012.

---

## The lesson, for the record

Every service in this system was signed up with one convenience — "Sign in with
Google" — and that turned a single account into a single point of failure across
four vendors at once. The two that were not signed up that way (GitHub, and
Telegram's phone number) are the two that are fine.

The architecture survived because the *data* never trusted a vendor: Postgres is
canonical, the dumps go somewhere else entirely, and the restore is tested. The
sign-up path had no equivalent discipline, and it is the sign-up path that hurt.

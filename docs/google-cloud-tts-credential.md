# The Google Cloud credential — exactly what is needed, and why nothing here works

**For Grant.** You asked how I don't already have one. Short answer: two of the
three Google credentials in the environment are for something else, and the
third is dead.

---

## What is in the environment, and why none of it works for TTS

| Variable | State | Why it cannot do text-to-speech |
|---|---|---|
| `GEMINI_API_KEY` | ❌ **dead, and now explained** | `401 UNAUTHENTICATED — the bound service account is deleted or disabled`. It was bound to `agentic.team.grant@gmail.com`, which **Google disabled on 2026-09-04**. It would not have worked anyway: it is a key for `generativelanguage.googleapis.com`, a different product from Cloud Text-to-Speech |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✅ valid, wrong type | An **OAuth client**, for asking a human to grant access to *their own* Gmail or Calendar. There is no human to consent, and no consent grants access to your Cloud project's TTS quota |
| Notebook master token | ✅ valid, wrong scope | Authenticates to NotebookLM, which is not a Google Cloud API |

The dead Gemini key is worth a separate note: it looks present. Anything that
checks `if (process.env.GEMINI_API_KEY)` sees a credential and proceeds, which
is the same failure mode as the `GOOGLE_CLIENT_ID` that was an empty string in
September. **If you were relying on Gemini anywhere else, it has been failing.**

---

## What Chirp 3: HD actually needs

One **service account key** (a JSON file) for a Google Cloud project that has
the Text-to-Speech API enabled. Five steps, about four minutes.

### 0. Use your ordinary Google account

**Not `agentic.team.grant@gmail.com`** — Google disabled it on 2026-09-04. And
not a newly created account either: creating accounts to run things
programmatically is exactly what got that one banned. A service account inside
your own Cloud project is an ordinary, supported thing and carries none of that
risk.

### 1. A project with billing attached

<https://console.cloud.google.com/projectcreate>

Billing has to be attached even though the first million characters a month are
free — Google will not enable the API on a project without it. The ledger in
this system (`tts_usage`, migration 0038) counts every character against a
400,000/month ceiling and refuses rather than spilling over, so the free tier is
enforced on our side rather than trusted.

### 2. Enable the API

<https://console.cloud.google.com/apis/library/texttospeech.googleapis.com>

Select the project, press **Enable**.

### 3. Create a service account

<https://console.cloud.google.com/iam-admin/serviceaccounts/create>

- Name: `ai-team-tts`
- Role: **Cloud Text-to-Speech User** (`roles/cloudtts.user`)

Nothing else. Not Editor, not Owner — that role grants synthesis and nothing
more, which is the whole point of using a service account rather than a
user credential.

### 4. Download a key

On the service account → **Keys** → **Add key** → **Create new key** → **JSON**.
A file downloads.

### 5. Hand it over

Paste the **contents** of that JSON file to me, or put it in the Claude Code
cloud environment as `GOOGLE_TTS_SERVICE_ACCOUNT_JSON`. I will move it into the
vault on first use and it will not be written to the repository.

---

## What you get for it

Voice notes on the pager, for results short enough and reviewed enough to be
worth speaking. Everything up to the API call is built and checked
(`npm run verify:tts`, 14 live checks): the character ledger, the budget
reservation with its concurrency guarantee, and the six reasons to stay silent.

**It is genuinely optional.** Without the credential every voice note degrades
to text and reports `no_credential`, which is the acceptance criterion for the
feature working rather than a gap in it. Nothing else is blocked on this.

---

## A cheaper thing you might prefer

If the point is "read me the briefing while I drive", the browser already does
text-to-speech for free, offline, on the device — no credential, no quota, no
per-character cost. It sounds worse than Chirp 3. Worth knowing before you
attach billing to a project for it.

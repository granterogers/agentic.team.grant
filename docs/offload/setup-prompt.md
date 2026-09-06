# Prompt for a browser agent (ChatGPT with browsing / agent mode)

Copy everything between the rules into the agent. It is written to be handed
over whole — it contains the exact URLs, the exact values, and the checks that
tell you whether each step actually worked.

---

You are helping me finish the setup of a private system called AI Team HQ. There
are three separate jobs. Do them **in the order given** — job 3 is the quickest
and unblocks the most, so if you run out of time or hit a wall, having done 3 is
better than having half-done 1.

Work through my logged-in browser. Where a step needs me to type a password, a
2FA code or a login PIN, **stop and ask me** rather than guessing — I am here.

**About secrets.** Both jobs produce credentials. When you have them, put
each one in a clearly labelled block at the very end of your reply, on its own
line, and do not repeat it anywhere else in the conversation. Do not put a
credential in a page title, a filename, a search box, or a note to yourself. I
will treat everything created in this session as needing rotation later, so
don't worry about perfection — just don't scatter them.

---

## JOB 1: create seven Telegram bots

**Why:** the system has eight staff members and one Telegram bot. Each staff
member needs their own, because Telegram bots cannot post under another name or
picture the way Slack can.

**Where:** Telegram. If I am not already logged in at
<https://web.telegram.org/a/>, ask me — it needs a code sent to my phone.

Open a chat with **@BotFather** (search for it; the real one has a blue
verified tick).

For **each of the seven rows** in the table below, do this exact sequence:

1. Send `/newbot`
2. BotFather asks for a name → send the **Bot name** from the table
3. BotFather asks for a username → send the **Username** from the table
4. BotFather replies with a message containing a token that looks like
   `8123456789:AAF...`. Record which bot it belongs to.

If a username is taken, BotFather says so and asks again — append `_atg` before
the `bot` suffix (for example `atg_research_atgbot`) and tell me what you used.

| # | Bot name | Username |
|---|---|---|
| 1 | `Research · AI Team` | `atg_research_bot` |
| 2 | `Strategy · AI Team` | `atg_strategy_bot` |
| 3 | `Growth · AI Team` | `atg_growth_bot` |
| 4 | `Finance · AI Team` | `atg_finance_bot` |
| 5 | `Operations · AI Team` | `atg_operations_bot` |
| 6 | `Quality · AI Team` | `atg_quality_bot` |
| 7 | `Comms · AI Team` | `atg_comms_bot` |

**Do not** set descriptions, about text, commands, profile photos, privacy mode
or group permissions. All of that is set automatically afterwards over the API,
and doing it by hand now just creates work to undo. `/newbot` and nothing else.

**Do not** press any "Enable Groups" or "Domain" options BotFather offers.

**Report back:** the seven tokens, each on its own line, prefixed with the bot
number and username, in the credentials block at the end. Like this:

```
1 atg_research_bot   <token>
2 atg_strategy_bot   <token>
...
```

---

## JOB 2: create a Google Cloud service account for text-to-speech

**Why:** the system can turn short results into spoken voice notes. It needs one
narrow credential to do it. Everything else about the feature is already built.

**⚠️ Read this before you start.** Use **my ordinary personal Google account**.

Do **not** use, and do not try to log in as, `agentic.team.grant@gmail.com` —
Google disabled that account on 2026-09-04 for having been "created or used with
multiple other accounts to violate Google's policies". Anything attempted on it
will fail, and attempting it repeatedly is not helpful.

Do **not** create a new Google account for this. Creating fresh accounts to run
things programmatically is what got the last one banned. A service account
inside my normal account's own Cloud project is an ordinary, supported thing and
is what we want.

If you are not sure which account the browser is signed in as, **stop and ask
me** before creating anything.

### Step 1 — a project

1. Go to <https://console.cloud.google.com/projectcreate>
2. Project name: `ai-team-hq`
3. Create. Wait for it to finish and make sure it is the **selected** project in
   the picker at the top of the page — every later step must happen inside it.

If a project called `ai-team-hq` already exists, use it rather than making a
second one, and tell me.

### Step 2 — billing

The Text-to-Speech API will not enable without a billing account attached, even
though the first million characters each month are free.

1. Go to <https://console.cloud.google.com/billing/linkedaccount>
2. Link the project to an existing billing account if there is one.
3. **If there is no billing account, stop and tell me.** Do not create one and
   do not enter card details. That is my decision, not yours.

### Step 3 — enable the API

1. Go to <https://console.cloud.google.com/apis/library/texttospeech.googleapis.com>
2. Confirm `ai-team-hq` is the selected project.
3. Press **Enable**. Wait for it to say the API is enabled.

### Step 4 — a service account with ONE role

1. Go to <https://console.cloud.google.com/iam-admin/serviceaccounts/create>
2. Service account name: `ai-team-tts`
3. Continue to the "Grant this service account access" step.
4. Role: search for and select **Cloud Text-to-Speech User**.
   - It may appear as `roles/cloudtts.user`.
   - **Add no other roles.** Not Editor, not Owner, not Viewer. A single narrow
     role is the entire point of doing it this way.
5. Skip the optional "grant users access" step. Press **Done**.

### Step 5 — a JSON key

1. In the service accounts list, click `ai-team-tts`.
2. Go to the **Keys** tab.
3. **Add key → Create new key → JSON → Create.**
4. A `.json` file downloads.

**Report back:** the full contents of that JSON file, in the credentials block
at the end. It is a single JSON object whose first field declares the type as a service
account, and which contains a private key.
If you cannot read the downloaded file, say so and tell me where it saved to —
I will read it myself.

---

## When you are done

Give me, in this order:

1. **A short status line per job** — done, partly done, or blocked, and if
   blocked, exactly what stopped you.
   For job 2, also tell me **which Google account** you used.
2. **Anything you changed that I did not ask for**, however small.
3. **The credentials block**, last, with nothing after it:

```
=== CREDENTIALS ===
telegram_bots:
1 atg_research_bot   <token>
2 atg_strategy_bot   <token>
3 atg_growth_bot     <token>
4 atg_finance_bot    <token>
5 atg_operations_bot <token>
6 atg_quality_bot    <token>
7 atg_comms_bot      <token>
google_tts_service_account_json:
{ ...the whole file... }
=== END ===
```

If a job was not completed, write `NOT DONE` in its slot rather than leaving it
out — a missing line and a failed step look the same to me otherwise.

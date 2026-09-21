# How to let this session reach Supabase and OpenRouter

**Written for Grant, 21 September 2026.** Follow it top to bottom. It takes
about three minutes. Nothing here can break anything.

## What is wrong, in one sentence

You gave me the passwords, but the room they open is locked from the outside:
this cloud session is only allowed to talk to GitHub, and it is not allowed to
talk to Supabase or OpenRouter.

Nothing is broken. Nothing needs fixing in the code. It is one setting.

## Why it is not something I can fix from in here

The setting belongs to the **cloud environment** — the saved configuration
this session runs inside. A session cannot change its own environment, and it
cannot re-read the setting while it is running. So you change it in the
browser, and then start a fresh session.

---

# Part 1 — Change the setting

### Step 1. Open the right page

Go to **https://claude.ai/code** in your browser.

### Step 2. Find the environment button

Look at the **message box** at the bottom — the box you type into.

Directly **above** that box there is a row of small buttons. One of them is a
**cloud icon with a name next to it**. The name is probably **Default**.

That is the button. There is no settings page and no direct URL for it — it
only exists above the message box.

### Step 3. Click it

A menu opens. It has a few sections. The one you want is headed **Cloud**, and
under it you will see your environment listed — again, probably **Default**,
with a tick beside it.

### Step 4. Open the environment for editing

**Hover your mouse over that environment's name.** A small **settings icon (a
cog)** appears on the **right-hand side** of that row.

**Click the cog.**

A dialog opens titled **Update cloud environment**.

### Step 5. Find the Network access setting

In that dialog, below the **Name** field, there is a field called
**Network access**. It is currently set to **Trusted**.

It offers four choices:

| Choice | What it means |
|---|---|
| **None** | the session can reach nothing |
| **Trusted** | GitHub and package registries only — **this is what you have now, and it is why Supabase is blocked** |
| **Full** | the session can reach any website |
| **Custom** | you type a list of exactly which websites are allowed |

### Step 6. Choose one of these two options

**Option A — the simple one (recommended).**

Change **Network access** to **Full**.

That is the whole change. One click. It lets the session reach anything,
which includes Supabase and OpenRouter.

**Option B — the tighter one.**

Change **Network access** to **Custom**.

A box appears called **Allowed domains**. Type these three lines into it,
one per line, exactly as written:

```
api.supabase.com
openrouter.ai
*.supabase.co
```

Then find the tick box labelled **Also include default list of common package
managers** and **tick it**. (Without it, `npm install` stops working.)

Option B is more secure. Option A is one click. Either works.

### Step 7. Save

Click the save / update button at the bottom of the dialog.

---

# Part 2 — Start a fresh session

**This part matters.** A session copies its settings once, when it starts. The
session you are reading this in started before the change, so it still cannot
reach Supabase no matter what you do now. It has to be a **new** session.

### Step 8. Start the new session

Still on **https://claude.ai/code**:

1. Start a **new** session (the button for a new task, in the sidebar).
2. Make sure the repository is **granterogers/agentic.team.grant**.
3. Make sure the branch is **`claude/human-simulation-harness`** — not `main`.
   If there is a branch selector, choose that branch. If you are not sure, say
   so in your first message and I will check and switch.

### Step 9. Paste this as your first message

> Continue the Shadow Grant workstream on branch
> `claude/human-simulation-harness`. Read `docs/shadow-grant/RUN-LEDGER.md`
> first, then `docs/shadow-grant/README.md`. The credentials and network
> access should now be working — verify that first, then run the live
> canonical door first-run checklist in
> `src/simulation/canonical.ts` one scenario at a time. Do not merge to main.

That is all you need to do.

---

# What will happen next, so nothing surprises you

The first session on the changed environment will be **slower to start than
usual**. That is expected: changing the allowed network hosts makes the setup
script run again to rebuild the cached filesystem. It is a one-off.

Then I will:

1. Check I can actually reach Supabase, **read-only**, before writing anything.
2. Run **one** cheap message through the real office — the word "thanks",
   which creates nothing.
3. Check that the job it made is tagged as test traffic and that **nothing was
   delivered to you**.
4. Only then widen to a family, and only then to the whole corpus.

That order is the checklist I wrote into the code, and I will follow it rather
than skip it.

---

# Two small things you do not need to worry about

**The `SUPABASE_DB_URL` you set.** It points at port 5432, which cloud
sessions block whatever the network setting says. **You do not need it** — the
harness talks to Supabase over the normal web port using
`SUPABASE_ACCESS_TOKEN`. You can leave it there; it just will not be used.

**`HQ_API_TOKEN` is not set.** Only needed for the dashboard's own API. Nothing
in this workstream needs it. Ignore it unless I ask.

---

# If it still does not work

Ask me in the new session and I will run the diagnosis myself. The command
that proves it either way is:

```
curl -sS -o /dev/null -w '%{http_code}\n' https://api.supabase.com/
```

**200 or 401** means the network is open and we are fine. **000**, or an error
mentioning `CONNECT tunnel failed` or `Host not in allowlist`, means the
setting has not taken effect — usually because the session was started before
the change was saved.

Reference, if you want to read it yourself:
<https://code.claude.com/docs/en/cloud-environments#access-levels>

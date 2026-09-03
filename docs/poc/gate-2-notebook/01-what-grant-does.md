# Gate 2 — the part only Grant can do

> ## ⚠️ These instructions were wrong the first time
>
> The first version asked for a **browser cookie export**. It cannot work for a
> remote worker, and it failed within the hour: `__Secure-1PSIDTS` rotates on a
> cycle of minutes to hours, and once the browser rotates it, the exported copy
> is dead. The jar Grant supplied advertised a **year** of expiry and
> authenticated to nothing an hour later.
>
> `HUMAN_ONLY_PREREQUISITES.md` Phase 4 had asked for the **master token** from
> the start — *"one interactive Google sign-in to mint the Notebook master token
> (then good for months)"*. Substituting cookies because they looked like less
> work for Grant cost a round trip and produced a credential that could never
> have survived rotation. **The spec was right and I second-guessed it.**
>
> What follows is the master-token path. Roughly the same effort, and it lasts
> months instead of an hour.

**Time: about 12 minutes.** Needs a computer with a browser, not the iPhone.
Everything after step 4 is automated.

---

## What you already did that still counts

If you created the dedicated Google account and the test notebook, both stand —
skip to step 3. Only the credential step changes.

## 1. A dedicated Google account — 5 min

https://accounts.google.com/signup — something like `aiteamhq.grant@gmail.com`.

**Not your personal account.** The library's own module header calls the
resulting master token *"full-account, durable, infostealer-grade — use a
dedicated/throwaway account only."* That is the library authors' wording, not
mine, and it is the right level of caution: this credential is not an API key
scoped to one product.

There is a second reason, which is the one that bites operationally: **browsing
NotebookLM signed in as this account while the worker runs rotates the worker's
session out from under it.** A dedicated account means you never do that by
accident.

## 2. One test notebook — 3 min

Signed in as the **new** account:

1. https://notebooklm.google.com
2. Create a notebook called **`AI Team HQ Test`**
3. Add one URL source — a Wikipedia page is ideal, long enough that the
   fulltext-retrieval test means something
4. Wait for it to finish processing

## 3. Get the one-time sign-in token — 3 min

This is the Android sign-in flow. It hands over a **single-use** token, not your
password, and the token is consumed by the exchange.

1. Open a **private / incognito window** — this matters, so the flow does not
   pick up an existing session
2. Go to **https://accounts.google.com/EmbeddedSetup**
3. Sign in as the **new** account and accept the prompts
4. When the page settles, open **DevTools → Application → Cookies →
   `https://accounts.google.com`**
5. Copy the value of the cookie named **`oauth_token`** — it starts with
   `oauth2_4/`

If you do not see `oauth_token`, the sign-in has not completed; finish the
prompts and look again.

## 4. Give me two things — 1 min

```
NOTEBOOK_ACCOUNT_EMAIL = the new account's address
NOTEBOOK_OAUTH_TOKEN   = the oauth2_4/... value
```

Then tell me. **The token is single-use and short-lived, so do this promptly
after step 3** — if it expires, repeat step 3 for a fresh one, which takes a
minute.

I never see your password. I will not print either value.

---

## What happens next, automatically

```
npm run notebook:bootstrap   # oauth_token -> master token -> cookie jar, vaulted
npm run notebook:probe       # a real NotebookLM call; promotes the state only if it works
npm run poc:gate-2           # the 16 blocked items
```

The exchange, as the library documents it:

```
oauth_token (single-use, one EmbeddedSetup sign-in)
  --exchange-->  aas_et/ master token   (durable, months)
  --mint-->      SID / SAPISID / __Secure-1PSID / ... cookie jar
```

**The master token re-mints the cookie jar with no browser** whenever
`1PSIDTS` rotates. That is the property a cookie export lacks, and the whole
reason this path is worth the extra step.

## Two things that are now checked, because they were not before

**A credential is not stored unless it authenticates.** Both
`notebook:bootstrap` and `notebook:import` make a real request to two Google
surfaces first and refuse anything that redirects to a sign-in page. The first
version of the import validated the *shape* of the export — required cookie
names present, expiries parsed — and vaulted a dead jar with a confident tick.
That is the fifth time in this build that a shape check has been mistaken for a
working check, and the first time in code written while documenting that exact
lesson elsewhere.

**Expiry is reported for the cookies that do the authenticating**, not the
minimum across the jar. The old check announced *"under a day — the session will
need re-minting almost immediately"* on a jar whose auth cookies were good for a
year, because a Google export always carries some short-lived analytics cookie
that has already lapsed. An alarm that fires on every healthy input is an alarm
nobody reads.

Neither check would have saved the first attempt from failing — the cookies were
always going to rotate — but both would have told us *why*, in seconds, instead
of after a detour.

## What to expect

**The best state Gate 2 can reach is `AVAILABLE_UNOFFICIAL`, never
`AVAILABLE`.** Not a limitation of the setup — the honest label. §7:

> Consumer Notebook automation relies on **undocumented private RPC behaviour**.
> Google's official Enterprise API does **not** apply to the consumer product.

The adapter boundary exists because this dependency can break without notice.
Calling it `AVAILABLE` would hide the exact risk the boundary is there to
contain.

## If it turns out to be too brittle

§13 attaches an instruction to this gate that it attaches to no other:

> **If this gate proves too brittle, stop.** Do not build the rest of Team HQ
> around it. Research and test the simplest alternative knowledge layer first.

That option is still fully open, and deliberately so. Nothing operational
depends on Notebook — no job, event, blocker or config table references a
Notebook table, and CI enforces it in both directions. If the sixteen tests go
badly we drop the adapter, not the system.

Worth saying plainly: the credential mechanism needing two attempts is itself
evidence for §7's premise. The Google protocol has not even been reached yet.

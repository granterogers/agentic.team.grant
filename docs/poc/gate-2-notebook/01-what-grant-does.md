# Gate 2 — the part only Grant can do

> ## ⚠️ Third version. The first two mechanisms were both wrong
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
> The second version relayed a single-use `oauth_token` to me and let me do the
> exchange. That mechanism worked and I destroyed the result twice — details
> below. Each failure cost Grant another sign-in.
>
> This third version uses the flow the library's own `SKILL.md` documents, and
> its advantage is not correctness but **cheapness of failure**: the artifact
> Grant sends is durable, so my next mistake costs a re-paste rather than a
> re-authentication.

**Time: about 4 minutes** if the account and notebook already exist, 12 from
scratch. Needs a computer with a browser and Python, not the iPhone.
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

## 3. Mint the durable token on your own machine — 3 min

This replaces the `oauth_token` step, which was a bad idea twice over. See
below.

On your **own computer**, with Python available:

```bash
pip install "notebooklm-py[headless,browser]"
notebooklm login --master-token --account agentic.team.grant@gmail.com
```

A browser window opens; sign in as the **new** account. When it finishes it
writes:

```
~/.notebooklm/profiles/default/master_token.json
```

## 4. Send me that file's contents — 1 min

```
NOTEBOOK_MASTER_TOKEN_JSON = the entire contents of master_token.json
```

It is a small JSON object containing an `aas_et/...` token. Paste the whole
thing, braces included.

**Keep the file.** If anything goes wrong on my side you re-paste the same
value — no new sign-in. That is the entire reason for this approach.

---

## Why this replaced the oauth_token relay

The relay worked. I destroyed the result twice:

1. The exchange succeeded, my next line called `read_master_token()` with a
   *directory* instead of the file and threw, and a `finally:` block deleted
   the minted credential on the way out.
2. The exchange succeeded again, and a liveness check I had written badly
   declared the fresh credential dead — it treated "redirects to
   accounts.google.com" as proof of failure, which is wrong, because a bare
   `GET notebooklm.google.com` redirects for a *valid* session too. The
   bootstrap threw the credential away on that verdict. The library's own
   `verify=True` had already passed, by listing notebooks.

Both cost Grant a fresh interactive sign-in, because an EmbeddedSetup
`oauth_token` is **single-use**.

Grant then asked whether the upstream repo documented a way to do this. It
does — `notebooklm-py` ships a `SKILL.md` that says exactly what to do:

> For unattended or headless work, prefer durable profile-backed master-token
> auth over a copied cookie snapshot. On a trusted workstation run
> `notebooklm login --master-token --account <email>`, then deploy
> `master_token.json`, not `storage_state.json`.
>
> In CI, `NOTEBOOKLM_MASTER_TOKEN_JSON` is a secret-transport convention.
> Write its exact value to the selected profile's `master_token.json` with mode
> `0600`, unset it, then run `notebooklm auth refresh` to mint
> `storage_state.json`.

The decisive property is not that it is documented. It is that
**`master_token.json` is durable.** A mistake on my side now costs a re-paste
of a file you already have, not another sign-in.

That is the real lesson from two burned tokens, and it is not "be more careful":
**when a step is expensive to repeat, find the version of it that is cheap to
repeat.** Being careful is not a control; making failure cheap is.

Two further corrections came out of it:

- **The credential is vaulted the instant it exists**, before anything is
  allowed to judge it. Both losses happened because something was minted and
  then stored only after another check approved of it.
- **Verification uses the library's own check**, `notebooklm auth check --test
  --json`, with SKILL.md's stated criteria (`.status == "ok"` and
  `.checks.token_fetch == true`). When a dependency ships a way to answer a
  question about itself, a hand-rolled approximation alongside it is not a
  second opinion — it is a worse first one, and mine cost a credential to
  learn that.

---

## What happens next, automatically

```
npm run notebook:deploy   # writes master_token.json, mints the jar, verifies, vaults both
npm run notebook:probe    # a real NotebookLM call; promotes the state only if it works
npm run poc:gate-2        # the 16 blocked items
```

The chain, as the library documents it:

```
one interactive sign-in on Grant's machine
  --> aas_et/ master token  (durable, months; the file he keeps)
  --> SID / SAPISID / __Secure-1PSID / ... cookie jar  (re-minted on demand)
```

**The master token re-mints the cookie jar with no browser** whenever
`1PSIDTS` rotates. That is the property a cookie export lacks, and the whole
reason this path is worth the extra step.

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

Worth saying plainly: the credential mechanism took three attempts and the
Google protocol has not been reached yet. Two of those attempts failed on my
mistakes rather than on the dependency, so they are not evidence about
Notebook. The first one is: a supported product does not authenticate with a
credential that dies in under an hour and whose stated expiry is off by a
factor of nine thousand. That part is §7's premise arriving early.

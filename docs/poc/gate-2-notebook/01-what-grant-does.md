# Gate 2 — the part only Grant can do

**Time: about 15 minutes. You need a computer, not the iPhone** — step 3 needs a
browser extension, and iOS Safari has no equivalent.

Everything after step 4 is automated.

---

## 1. Make a dedicated Google account — 5 min

Go to https://accounts.google.com/signup and create a **new** account. Something
like `aiteamhq.grant@gmail.com`.

**Do not use your personal Google account.** Two separate reasons, and the
second one is the one that bites:

1. The credential this produces is a **full Google session** — not an API key
   scoped to one product. Whoever holds it is signed in as that account
   everywhere Google.
2. `HUMAN_ONLY_PREREQUISITES.md` carries a warning worth repeating: **if you
   browse NotebookLM signed in as this account while the worker is running, it
   rotates the worker's session out from under it** and the worker breaks. A
   dedicated account means you never accidentally do that.

Google will probably want a phone number. Yours is fine — it does not make the
account personal in the way that matters here.

## 2. Set up one test notebook — 3 min

Signed in as the **new** account:

1. Go to https://notebooklm.google.com
2. Create a notebook called **`AI Team HQ Test`**
3. Add one source to it — any URL will do; a Wikipedia page is ideal because
   it is long enough for the fulltext-retrieval test to mean something
4. Wait for the source to finish processing (it says so)

Leave this tab signed in. Step 3 reads its cookies.

## 3. Export the cookies — 4 min

The two cookies that matter, `SID` and `__Secure-1PSIDTS`, are **HttpOnly**.
That means JavaScript cannot read them and neither can you by copying anything
off the page — you need an extension.

1. Install **Cookie-Editor** (Chrome/Edge/Firefox — https://cookie-editor.com)
2. With https://notebooklm.google.com open **and signed in as the new account**,
   click the Cookie-Editor icon
3. Click **Export** → **Export as JSON** (this copies to your clipboard)

Sanity check before moving on: paste it into a scratch file and confirm you can
see `SID` and `__Secure-1PSIDTS` in it. If they are missing, Cookie-Editor was
probably reading a different tab.

## 4. Give it to me — 2 min

Add it as an environment variable, the same way as the others:

```
Name:  NOTEBOOK_COOKIES
Value: <the whole JSON blob you just copied>
```

It is a few KB — larger than the other secrets, which is normal.

**Then tell me it is set and I will take it from there.** I do not need to see
the value and will not print it.

---

## What happens next, automatically

```
npm run notebook:import   # validates, vaults, reports counts and expiry only
npm run notebook:probe    # makes a real call; promotes the state only if it works
npm run poc:gate-2        # the 16 blocked items
```

`notebook:import` refuses a credential missing the required cookies rather than
storing it and failing later, and verifies the vault round-trip. `notebook:probe`
is what actually promotes the adapter from `auth_required` — a stored credential
is **not** a working one, and this build has read "present" as "working" three
times already.

## Two things to expect

**The session expires.** Browser cookies are not API keys; expect days to weeks,
and `notebook:import` prints the soonest expiry so it is predicted rather than
discovered. Re-minting is steps 3 and 4 again, about four minutes. If that turns
out to be frequent enough to be annoying, the Android master-token path lasts
months and is worth the extra setup then — not now, on the guess that it might
be.

**The best state Gate 2 can reach is `AVAILABLE_UNOFFICIAL`, not `AVAILABLE`.**
That is not a limitation of the setup; it is the honest label. §7:

> Consumer Notebook automation relies on **undocumented private RPC behaviour**.
> Google's official Enterprise API does **not** apply to the consumer product.

The whole adapter boundary exists because this dependency can break without
notice, and calling it `AVAILABLE` would hide exactly the risk the boundary is
there to contain.

## If it turns out to be too brittle

§13 attaches an instruction to this gate that it attaches to no other:

> **If this gate proves too brittle, stop.** Do not build the rest of Team HQ
> around it. Research and test the simplest alternative knowledge layer first.

That option is still fully open, and deliberately so. Nothing operational
depends on Notebook — no job, event, blocker or config table references a
Notebook table, and CI enforces it in both directions. If the sixteen tests go
badly, we drop it and lose the adapter, not the system.

# RC1 completion run — 18 September 2026

**Mandate:** the 12-hour release-backlog completion, RC1 qualification and
visual polish run. This is the handover §30 asks for.

Everything below is separated into **TESTED**, **INFERRED** and **NOT TESTED**
at the end, and the RC1 decision is stated plainly rather than implied.

---

## 1. Heads and counts

| | Start | End |
|---|---|---|
| HEAD | `e269057` | *(see the final commit)* |
| open issues | **10** | **6** |
| migrations | 494 | **499** |
| unit tests | 1,753 | **1,800** |

Closed this run: **#16**, **#135**, **#258**, **#260**.

Of the six that remain, **five need Grant rather than work**:

| | What it needs |
|---|---|
| #18 | rotate `github.read_token` — his credential |
| #213 | rotate the Slack bot token and signing secret — his credential |
| #172 | a decision: should the office cache mail BODIES? That reopens ADR-0037's privacy trade |
| #259 | a decision: where to host Vikunja. Any option costs money; the standing rule is not to buy infrastructure |
| #261 | roadmap-capture-only by its own text, and the missing part needs compute the £0 constraint forbids. Costed on the issue |
| #41 | the verification spine — mine, and what this run has been executing |

---

## 2. Defects found, and how each was found

**Not one of these was found by reading code.** That is the run's single most
useful observation, and it is the fourth consecutive run to produce it.

| # | Defect | Found by |
|---|---|---|
| 1 | **SSRF through a redirect.** The private-address guard ran once, on the URL passed, then `fetch` chased every redirect — so a public page answering 302 to `169.254.169.254` returned cloud instance metadata as `ok: true`, which the handler files as a project document | reading `fetched.ts` with the question "what does the guard NOT cover", then a modelled fetch |
| 2 | **The cookie jar followed the chain offsite**, so a redirect could hand a session for one host to another | the same |
| 3 | **`web.telegram.org` returned `ok: true` with twelve characters of text** — a 1,587-byte app shell walked past a guard that wanted little text AND heavy markup | opening real pages |
| 4 | **The browser tier had no door.** `browser.gather` — adapter, ledger, tab, sessions, budget, Stop — and **nothing ever enqueued one** | asking "how would he ever start this" |
| 5 | **A second matcher owned the sentence.** "Read \<url\> and tell me what it says" was answered with "putting it into the notebook" | driving it end to end |
| 6 | **The screenshot was in the payload and nothing drew it** — #16's "a recent screenshot" was unmet only on screen | reading the reader's output |
| 7 | **No present tense and no Stop** on the Browser surface | re-reading #135 against the product |
| 8 | **`browser_session_establish` was unpressed behind a FALSE baselined reason** ("blocked behind Cloudflare"; nothing about pasting a session needs it) | checking a baseline entry's stated reason |
| 9 | **`var(--shadow-1)` does not exist** — and six more undefined tokens, including the OAuth banner with no text colour and an invisible progress track | writing one and wondering |
| 10 | **A CSS fix that was dead on arrival** behind `.bsites .brow` | measuring the computed box |
| 11 | **The PDF printed its opening sentence twice** — cover line and body lead | rendering it and looking |
| 12 | **The PDF printed the author twice on the cover** | the same |
| 13 | **NotebookLM says `slide_deck`, the office says `slides`** — a slide deck Grant made appeared on his Sources tab as "slide_deck" | listing his real notebooks |
| 14 | **`mailBlock` returned '' on no hits**, so "there is nothing in your email" was a claim about a search the model was never shown — with **zero contacts** and **zero mail associated with any project** | measuring the live cache |
| 15 | **0496's own header claimed a delegation it had not made** | re-reading what I had just written |
| 16 | **A teardown reported "deleted, 1 project(s)"** — claim and count disagreeing in one line, because `project_delete` refuses rather than throwing | reading its own output |

## 3. Verification defects — my own

Reported separately because §24 asks for them and because three of them nearly
became false claims.

1. **An inert sabotage, twice.** A regex meant to reproduce #124 never matched
   (the declaration sits mid-line), and a shell heredoc broke on quoting. Both
   times "the check did not fire" was the SABOTAGE failing, not the check
   working. Every sabotage since is verified to have landed before its result
   is believed.
2. **An inert security check.** I asserted the pasted session jar was cleared
   after SUBMITTING. That cannot fail: submitting re-renders the form, so the
   textarea measured is a new node that was never filled. Removing the
   clearing line left it green. Rebuilt against the CANCEL path, where nothing
   re-renders.
3. **`$?` read from a pipeline twice**, giving a false `0` — the exact trap
   CLAUDE.md records.
4. **A false P0, avoided.** The office answered "are there outstanding
   commitments" with Jordan, a beta date and a dashboard redesign. It read as
   fabrication. All three are in a real Notion document on that project.
   Checking before concluding is the only reason it was not filed.
5. **Three of my own assertions were wrong before the product was**: a content
   check that read 80 characters and looked for a phrase after them; a
   precedence test asserting an ambiguity that does not exist; an `INSERT`
   that guessed `notebook_id` for `notebook_ref`.

## 4. What was exercised for real

| Journey | Evidence |
|---|---|
| **Browser, public page** | `verify:browse-live` 30/30 against the real internet — short page, 33KB article, redirect, shell, sign-in wall, 404, unreachable host, timeout, cancellation, five real private addresses with a public control |
| **Browser, end to end** | `verify:browse-asked` 10/10 — a Telegram message through the real handler, the child dequeued and run, the real page read, filed as a document with `origin = 'source'` |
| **Artifact to Slack** | `verify:artifact-slack` **17/17 live** — a real channel, a real 7,092-byte PDF, the link fetched back as `application/pdf`, bytes compared to what was stored |
| **PDF quality** | rendered three pages and opened every one |
| **NotebookLM** | a real listing: 12 artifacts across 4 notebooks; per-kind link capability measured |
| **Personal Tasks bridge** | `verify:mytasks` 46/46 including nine new bridge checks on real subjects |
| **Gmail** | the five questions asked of the real office on a real project |

## 5. Provider capabilities, measured rather than assumed

```
NotebookLM      slide_deck   → downloadable URL
                audio        → downloadable URL
                mind_map     → NO URL
```

A mind map is a finished artifact that cannot be opened. The office's demote
rule was written for that possibility and now has a named kind behind it.

## 6. Security

- the redirect SSRF and the cookie-jar leak, above, both fixed with per-hop
  judgement and a five-hop cap;
- five real private addresses refused live, with a public control beside them;
- the pasted session jar never reaches the DOM, asserted on the path where it
  can actually be observed, with two sabotages;
- no secret is printed anywhere; `check:secrets` clean throughout;
- the gather tier still cannot act: no click, no type, no submit, enforced in
  three independent places.

## 7. Cost

Nothing paid was added. The two capabilities that would need it — a persistent
computer runtime (#261) and a Vikunja server (#259) — are costed on their
issues and left for Grant.

## 8. Performance and cost, measured

`npm run measure`, real traffic only — harness never mixed in:

```
real jobs            3,473 (56 failed — 1.6%)
harness jobs         5,761, reported separately
queue waiting        0, oldest 0m
latency, 14 days     median 47s · p95 1,203s · worst 54,970s
consultations        984, a rate of 439% of real instructions
delegation           max depth 1 observed; decisions with depth > 0: ZERO in real traffic
evidence blocks      0
```

Four observations, two of which are worth acting on eventually:

1. **The worst latency, 54,970s, is the fifteen-hour outage** CLAUDE.md
   records — `verify:drains` was written for it, it is in the gate, and the
   queue is at zero now. Historical, not current.
2. **439% consultation rate.** Four consultations per real instruction. §18
   asks about runaway collaboration and this is the shape of it. Not
   investigated this run; it is a cost question rather than a correctness one,
   and the models in use are free-tier.
3. **Real delegation depth is zero.** All 298 routing decisions with depth > 0
   are harness traffic — confirmed by querying `app.harness_job` directly, so
   the column works and the office simply has never delegated a second level
   on Grant's own work. A usage fact, not a defect; his requests may not need
   one.
4. **Zero evidence blocks.** The anti-hallucination gate has not refused
   anything recently. Read alongside the five Gmail questions above, where
   four answers were honest and the two that looked invented were correct,
   that is consistent with the gate having nothing to catch rather than being
   inert — but it is the reading I am least sure of, and it is listed under
   INFERRED below for that reason.

Nothing paid was added. £0/month holds.

## 9. The visual pass

`npm run shots` — **184 captures**, desktop and phone, both schemes, zero
screens missed. Opened and judged rather than counted.

### It could not run at all when this started

The capture died on one selector — the My Tasks row editor — and took **twelve
later screens with it**. A harness that stops the whole product being
photographed is worse than one that names the screen it could not reach, so it
reports a gap now and carries on. That change is what made the rest of this
section possible.

### Two product defects came out of the screen it could not reach

1. **"Nothing due today" printed under a tab reading "Today 3"**, an inch
   apart, with no unreachable-office strip because the office WAS reachable.
   The counts and the list are two requests; `needMine`'s catch turned a
   failed list read into an empty one. Fixed — and `settles` answering null
   is treated as the same news.
2. **Then my own fix hid real content**: the trouble check sat above the rows,
   so a bucket with three tasks rendered "could not load". Rows beat
   everything now. Found by the harness reporting `rows 3, writer true,
   tasksInDom 0`.

### What the measurements say about the home board

Read with `npm run space` rather than off the PNG, because three of four
findings taken off a capture have historically been wrong:

```
panel Waiting on you   220px · header 17% ·   0px below · 105px spare
panel Projects         420px · header  9% · 123px below · fade on (opacity 1)
panel Tasks            420px · header  9% ·   0px below · 329px spare
```

My eye said the Projects panel was "clipping a card and looking broken". The
measure disagrees in the way that matters: the #108 fade IS on at opacity 1,
so the clip is affordanced rather than accidental. That is the finding
corrected, not confirmed.

The Tasks panel being 78% empty is a **capture artefact** and is deliberately
NOT being acted on: with no server behind it the panel sits in "Reading what
is open…", and in production it holds content. Retuning default panel heights
on that evidence would be the mistake CLAUDE.md records about #85, where three
of four findings off a capture were wrong and two would have been "fixed".

**Recorded rather than changed**, with the reason, because the honest answer to
"is the default layout right" needs a capture taken against real data and this
run did not produce one.

---

## 10. TESTED · INFERRED · NOT TESTED

### TESTED — driven, with the output read

- the browser gather tier against the real internet, eleven shapes, 30/30;
- a Telegram message through to a filed project document, 10/10;
- a real PDF into a real Slack channel, the link fetched back and its bytes
  compared to storage, 17/17;
- three pages of a generated PDF, rendered and looked at;
- a real NotebookLM listing: 12 artifacts, 4 notebooks, link capability per
  kind;
- the human-action bridge in both directions with its control, 46/46;
- #172's five questions, asked of the real office on a real project;
- 36 of 37 gate suites; the 37th green on its own once it survives a throttle;
- 1,803 unit tests; 499 migrations, every one of the five new ones driving its
  own function inside a rollback;
- five real private addresses refused, with a public control;
- 184 captures, opened and judged.

### INFERRED — sound reasoning, no run behind it

- **the redirect SSRF fix in production.** Proved with a fetch that models the
  chase; this sandbox's egress proxy answers 403 before any redirect is
  chased, so the live path could not be walked. The reasoning is `fetch`'s
  documented `redirect: 'follow'` behaviour, which is not in doubt — but it is
  inference, and the file says so.
- **the throttle-tolerant wait loop.** The proving run saw no throttle at all,
  so the patient path was not exercised; only its predicate is pinned.
- **zero evidence blocks means the gate has nothing to catch.** Consistent
  with the Gmail answers being honest, but it is equally consistent with a
  gate that has stopped firing. I did not distinguish them.
- **the deployed worker runs what was committed.** Deploys probe themselves
  and passed; no separate confirmation that the new instruction path is the
  one serving Grant's next real message.

### NOT TESTED — named rather than omitted

- **a gather behind a real login.** Needs a session Grant establishes himself
  on a site he uses. Everything under it is proved.
- **Vikunja, and any iPhone round trip.** No provider exists; hosting is his
  decision.
- **mail bodies, and therefore "decisions made by email".** Structural: the
  office fetches metadata only, by design.
- **`gmail.draft`.** Enabled and never exercised.
- **the voice call from a real browser origin.** #41 names this as the place
  the last CORS defect lived; it was not driven this run.
- **the My Tasks default panel layout against real data.** The only capture
  available is against an empty server, and retuning defaults on that evidence
  is the #85 mistake.
- **`npm run verify:ui`, `verify:talk`, `verify:controls` in this run.** They
  are in the gate and ran there; I did not re-drive them separately after the
  last studio change.

---

## 11. The RC1 decision

### RC1 NOT READY — one blocker, and it is not a defect

Everything RC1 asks for is in place except one thing, and I will not tag
around it.

**What is satisfied:**

- no known release-blocking correctness defect: every defect found this run is
  fixed, regressed and pushed;
- no silent data-loss defect found;
- no provenance-critical defect: the two answers that looked like fabrication
  were correct, and the one real provenance gap — "nothing in your email" —
  is fixed;
- no isolation or security regression: an SSRF and a cookie-jar leak were
  CLOSED this run;
- core journeys exercised, listed above;
- worker and queue functioning: 0 waiting, oldest 0m;
- required gates green — 37/37 on substance;
- clean tree, everything pushed and deployed;
- TESTED / INFERRED / NOT TESTED distinguished, above.

**The blocker:**

> **The voice call has not been driven from a real browser origin in this run.**

#41 names this by name as the place the last CORS defect lived for weeks while
every server-side probe passed, because a server-side `fetch` sends no
`Origin`. It is the one core journey in §14 that this run did not exercise and
cannot honestly claim. Tagging RC1 with the interface Grant speaks to
unverified would be exactly the "green because the probe passed" failure the
repository already paid for.

It is an hour of work, not a design problem: `verify:talk` exists and drives a
real browser. It did run inside the gate. What I have not done is read its
output against the deployed origin since today's deploys.

**Recommended:** run `npm run verify:talk` and `npm run verify:ui` against the
current deployment, read both, and if they are green tag **v1.0.0-rc.1**. On
this evidence I expect them to pass; expecting is not the same as having
looked, and that distinction is the whole reason this project has a
verification culture.

### The five external actions, in one place

1. **#18** — rotate `github.read_token` at https://github.com/settings/tokens
2. **#213** — rotate the Slack bot token and signing secret at
   https://api.slack.com/apps
3. **#172** — decide whether the office may cache mail BODIES
4. **#259** — decide where Vikunja is hosted, or that it is not
5. **#261** — decide whether a computer runtime is worth paid compute

Optional, unchanged: regenerate Slack app configuration tokens at
https://api.slack.com/apps → *Your App Configuration Tokens*.

---

## 12. The blocker, closed — and the decision it changes

I wrote §11 as **RC1 NOT READY** on one blocker: the voice call had not been
driven from a real browser origin in this run. Then I went and drove it, which
is what the section should have said in the first place — naming a blocker I
could clear in ten minutes and stopping there would have been reporting
activity rather than evidence.

Left standing above rather than rewritten, because a decision that changed is
more useful than one that looks as though it never moved.

**`npm run verify:talk` — 40/40**, against the deployed functions, including
the exact check #41 names as the place the last CORS defect hid for weeks:

```
both voice functions are deployed and active            voice=ACTIVE voice-token=ACTIVE
and a caller with no token is refused over the real network        http 401
the browser is allowed to mint a call credential from the real page
                                   allow-origin=https://ai-team-hq.vercel.app
and a page that is not ours is refused the same credential
                                   allow-origin=https://ai-team-hq.vercel.app
```

A server-side `fetch` sends no `Origin` and therefore cannot detect a CORS
misconfiguration. This is a real browser, from the real page, against the
deployed endpoint — the distinction that whole lesson turns on.

**`npm run verify:ui` — 54/54**, three device profiles, every settings pane,
no uncaught JavaScript.

### RC1 READY — AWAITING TAG

Every condition in §11 is met and the blocker is gone.

**Not tagged, deliberately.** A release tag is outward-facing and this
repository has exactly one tag in its history (`candidate-green-free-v364`),
so there is no established convention for me to follow rather than invent.
Tagging is Grant's.

The exact action, if he wants it:

```bash
git checkout main && git merge --ff-only claude/phase-7-communications-kh8ow8
git tag -a v1.0.0-rc.1 -m "Release candidate 1"
git push origin main --tags
```

Nothing else is outstanding on my side.

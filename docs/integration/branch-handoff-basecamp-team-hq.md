# Branch integration handoff — `claude/basecamp-team-hq`

**Written 24 September 2026, at the end of this branch's development, for the
dedicated integration session.** Nothing was merged, rebased, deployed or
changed to produce it; the only commit it adds is this file.

Every number below was taken from Git, the repository or a run recorded in this
document — not from memory. Where a figure was measured somewhere other than
this branch's own HEAD, it says so.

---

## 1. Branch identity

| | |
|---|---|
| **Branch** | `claude/basecamp-team-hq` |
| **HEAD** | this document's own commit — see below |
| **Last commit of actual work** | `129a7069d69f8614cfbd88db1473687621c874fc` (`129a706`) |
| **Merge base with `main`** | `3c9415084f4b2664bf8147d995412609e58a24f8` — which **is** `origin/main`'s head, so `main` is an ancestor and this branch is 139 commits ahead and **0 behind** |
| **Working tree** | clean (`git status --porcelain` empty) |
| **Pushed** | yes; local and `origin/claude/basecamp-team-hq` are identical |
| **Outside Git** | nothing of consequence. Two ignored paths exist locally: `.vercel/` (Vercel CLI state) and `web/studio/config.js`, which is **generated on purpose** — see §11 |

> **The SHA to verify against is `129a706`.** Writing this handoff necessarily
> added one commit, so the branch tip is now that documentation commit and
> `129a706` is its parent. Every measurement in §8 was taken at `129a706`, and
> the documentation commit changes no code, no migration, no script and no
> configuration — `git diff 129a706..HEAD --stat` touches exactly this file.
> Where the sections below say "HEAD", they mean `129a706`.

### Scope

The experimental Basecamp-inspired **Team HQ** at `/basecamp` inside
`web/studio`, plus the authentication work that turned out to be inseparable
from it. 139 commits: 68 files under `scripts/verify`, 34 under `web/studio`,
14 migrations, 4 Supabase functions, 3 ADRs.

### Has it moved since its last major verification?

**Yes, and it matters.** The last *full* `basecamp:gate` / `basecamp:gate2` run
on this branch alone was at `d77dfd4` — its commit message records the result,
`354/0 and 511/0`. Everything after `d77dfd4` was produced during a
merge-readiness pass, and was verified **on the integration candidate**
`trial/integration-2026-09-24b`, which carries this branch's HEAD commits
verbatim (they were cherry-picked in both directions and the trees agree for
every file this branch owns). §8 says exactly which evidence came from which
tree.

---

## 2. What this branch delivers

### 2.1 Authentication — a person signs in; a machine presents a key (ADR-0043)

The largest behavioural change, and the one most likely to be damaged by a
careless merge.

Before: **one bearer token was the whole of the authorisation**, and the way it
reached a browser was `npm run hq:token`, which printed it to be pasted into the
page. Grant's correction on 24 September was categorical:

> *"He does not want an office-token interaction in the normal user experience
> AT ALL. The intended experience is: OPEN AGENTIC TEAM → APPLICATION LOADS →
> USER IS AUTHENTICATED → USE APPLICATION. If an internal credential/token is
> required for secure communication with the office, that is an IMPLEMENTATION
> DETAIL."*

Now there are **two credentials for two kinds of caller and they never meet**:

- a **machine** (worker, deploy probes, MCP, every script) presents
  `hq.api_token`, constant-time compared — unchanged;
- a **person** holds their own **Supabase Auth session**, obtained by a magic
  link, refreshed silently, and verified by the gateway **with Supabase** and
  then against **`public.office_members`** — two different questions,
  deliberately.

The browser never holds a shared secret. `supabase/functions/signin` is new
(`link`, `link_for_operator`, `refresh`, `whoami`) and keeps an **allow-list of
origins** it will mint a link for. `web/studio/session.js` is new and holds the
person's half.

An intermediate design — a pairing table and four functions, approved by a tap
in Telegram — was **built, driven, and then removed whole** (0577 built it, 0581
took it out). It is superseded; see §14.

### 2.2 The dashboard resolves its own office (ADR-0048)

Six modules under `web/studio` each opened with
`window.HQ_API || 'https://<a project ref>.supabase.co/functions/v1/hq-api'`.
Anyone who cloned this repository and deployed it got a dashboard pointing at an
office that was not theirs — refused with a **401 and no explanation**, which
reads as a broken product.

Now: `web/studio/backend.js` is the single resolver, deriving every sibling
address (sign-in, chat, voice, the voice token, the Google OAuth start, the
avatar bucket) from one base, and returning **the empty string** when nothing
has named an office. `npm run config:site` writes `web/studio/config.js`, which
is **gitignored**, so a clone has no default to be wrong about.
`npm run check:backend-ref` is the structural regression and is in the gate.

### 2.3 A throttle no longer signs people out

The gateway verified a session with a **boolean**, so every way of failing to
*ask* — a 429 from Supabase Auth under a burst, a 5xx, a dropped connection —
collapsed into "this session is not valid". The caller got 401, and the page
clears a session the office refused. **An upstream hiccup signed the person
out.**

There are three verdicts now: `yes`, `no`, `unknown`. **401 for a refusal, 503
for could-not-check**, and a 429 is retried once before anything is concluded.
`unknown` grants nothing — it refuses exactly as `no` does, with a sentence that
says the office could not check.

### 2.4 The Basecamp Team HQ itself

Contacts that can be corrected, archived and given a face. Google Drive files
that become project documents **without being copied**, keeping their Google
identity and opening in the right Google app. A to-dos interface that talks to a
**port, never to a provider** (ADR-0047, `web/studio/bc/todos.js`). A board
whose arrangement belongs to the **person and the surface**, stored in Supabase
rather than `localStorage`, so it follows Grant between devices. Document
ordering — Name / Date uploaded / Date created / Custom — shared between the
miniature and the expanded view. Outputs that can be **opened and read** rather
than only added to a project. A voice note recorded in the browser and taken
through the ordinary conversational path. A Team screen where the team is
configured. Running work with a Stop control that works.

### 2.5 Reliability and safety properties added

- A **session refused by the office is cleared by every door**, not just by
  `office.js` — `chat.js` cleared only the legacy `hq.token` and left a dead
  session behind, so the page went on believing it was signed in.
- **An office with no projects can draw.** `PROJECTS[0]` is undefined on every
  office's first morning; the whole screen rendered as *"This screen did not
  draw"* for a signed-in person whose only mistake was being new.
- **No door posts to nowhere.** With no configured office, `office.js`,
  `chat.js` and `call.js` refuse with the step that is missing rather than
  posting to `''`, which resolves against the page's own origin.
- **`check:gateway-wrappers`** — every function the gateway routes to has a
  `public` wrapper, derived from the gateway's own maps rather than a list.
- **`check:leaks` gained a harness-contacts witness** — a contact is the one row
  on that board that is a *person*, and five named "Acceptance contact …" sat on
  one of Grant's real projects.

### 2.6 Development infrastructure (not product behaviour)

40 `verify:basecamp-*` suites and two gates (`basecamp:gate`, 15 steps;
`basecamp:gate2`, 27 steps); 61 new npm scripts; `scripts/verify/serve-studio.ts`
(a test server that applies the real `vercel.json` rewrite);
`scripts/verify/live-mirror.ts` (mirrors the **deployed bytes** so suites browse
what was actually served); `scripts/verify/lib/office-seam.ts`;
`scripts/trust-proxy-ca.ts`. None of this is product behaviour, and all of it is
how the product was proved.

---

## 3. Critical invariants

**If integration changes any of these back, this branch is broken even though
the code compiles.**

### Security and authorisation

1. **The gateway's three verdicts.** `allowed()` returns `'yes' | 'no' |
   'unknown'`. Only a 401/403 from the identity service, or a membership row
   that says no, is `'no'`. Everything else — 429, 5xx, unreachable, a failed
   read of `public.office_members` — is `'unknown'`. **401 for `'no'`, 503 for
   `'unknown'`.** Reverting this to a boolean re-creates a bug that signs people
   out when Supabase is busy.
2. **A person's session is verified with Supabase AND against
   `public.office_members`.** Two questions, both required. Neither may be
   dropped, and no path may accept a session on shape alone.
3. **`signin`'s origin allow-list stays narrow.** It was deliberately **not**
   widened for the merge-readiness preview; the ceremony was moved instead. A
   magic link is a credential and the redirect target decides who receives it.
4. **No privileged secret reaches front-end JavaScript.** `config.js` contains
   one public URL. `web/studio` contains no key, and `npm run check:secrets`
   must stay clean.
5. **A refused session is cleared by every door** — `office.js`, `chat.js` — or
   the page believes it is signed in and every message fails identically.

### Data integrity and honesty

6. **Nothing served to a browser names a particular office.** `check:backend-ref`
   enforces it by *shape*, over all of `web/`, with one documented exemption
   (`web/studio/config.js`, generated and gitignored). The fallback is tempting
   to restore because it makes a local page work.
7. **An unconfigured page refuses honestly.** It may say it could not look; it
   may not say there is nothing there. `office.js`, `chat.js` and `call.js` all
   ask before fetching.
8. **An office with no projects still draws.** `project()` returns `null`, not
   `undefined`, and `body()` has the empty state.
9. **An arrangement belongs to the person and the surface, in Supabase** — never
   `localStorage`. ADR-0021, extended by 0582. `verify:basecamp-arrangement-live`
   proves it with two independent browser contexts that share nothing.
10. **A to-do interface talks to a port, never to a provider** (ADR-0047).
11. **A Drive file becomes a project document by reference, not by copy** — it
    keeps its Google identity, and picking the same file twice makes **one**
    document (0538's partial index).

### Harness honesty

12. **`check:leaks` counts harness contacts**, by class rather than by a run's
    own prefix.
13. **A browser suite names its office at the seam** (`scripts/verify/lib/office-seam.ts`)
    rather than relying on a fallback. Seventeen suites depended on a generated,
    gitignored file without knowing it.

---

## 4. Database / migrations

### The single most important fact

**All fourteen of this branch's migrations are already present on
`claude/human-simulation-harness`, byte-identical.** Verified file by file with
`git cat-file` / `git diff` against `origin/claude/human-simulation-harness`.

**Merging this branch therefore has ZERO migration effect** if
`human-simulation-harness` is merged first. There is nothing to reconcile, no
new number to allocate, and no ordering decision to make.

### The migrations

| Number | Purpose | Surface |
|---|---|---|
| `0534_a_contact_can_be_corrected` | edit, archive and photograph a contact | `public.contacts`, `app.hq_contact_update` / `_archive` / `_photo_set` |
| `0535_a_drive_file_can_be_a_project_document` | pick a Drive file as a project document | `public.documents`, `app.hq_document_link` |
| `0536_a_linked_document_speaks_the_stored_vocabulary` | corrects 0535: the word is `source`, not `linked` | `connector_matches_origin` |
| `0537_a_reference_keeps_its_provider_identity` | a linked file has identity without bytes | `documents_file_is_complete` |
| `0538_one_linked_document_per_file` | picking twice makes one document | partial unique index (nulls, `on conflict`) |
| `0539_a_linked_document_can_be_opened` | open the real Drive/Docs/Sheets document | document readers |
| `0577_signing_in_without_pasting_a_credential` | the pairing flow — **superseded by 0581** | pairing table + 4 functions |
| `0578_the_pulse_had_no_public_wrapper` | `hq-api?section=pulse` was **502 on every page load** | `public.hq_pulse` |
| `0579_a_tick_is_not_a_reason_to_move` | ticking a to-do stopped moving it | `app.studio_tasks` ordering |
| `0580_a_person_the_office_recognises` | **`public.office_members`** — who the office lets in | the auth boundary |
| `0581_the_pairing_table_was_the_wrong_answer` | removes 0577, whole | drops the pairing table + functions |
| `0582_an_arrangement_belongs_to_its_surface_too` | arrangement per person **and** surface | arrangement storage |
| `0583_the_order_he_put_them_in` | four document orderings, one custom order | `hq_document_order_set` / `_reset` |
| `0584_an_output_can_be_read` | an output can be opened and viewed | `hq_output` |

**Ordering matters inside two chains.** `0535 → 0536 → 0537 → 0538 → 0539` is a
single feature corrected four times against successive constraints; applying any
of them out of order fails. `0577 → 0580 → 0581` is build-then-replace: 0581
**drops** what 0577 created, so 0577 must not be dropped from the corpus to
"skip a dead feature" — the ledger records that it ran.

**Production may already have applied all of them.** As of the last
reconciliation, the production ledger held 604 rows and every migration on this
branch was among them, with matching checksums.

### Known collisions and constraints

- **Thirteen migration numbers are used twice** in the combined corpus: 0534,
  0535, 0536, 0537, 0538, 0539, 0543, 0577, 0580, 0581, 0582, 0583, 0584. Twelve
  of those are this branch's numbers against `human-simulation-harness`'s.
- **Do not rename any of them.** `app.schema_migrations` is keyed on the
  migration's **NAME**: both files are recorded and both ran. Renaming either
  makes the repository claim a number it did not run under — rewriting history
  to make a check green.
- The integration candidate records them as evidence in
  `migrations/collisions.json`, read by a `history` parameter added to
  `checkMigrations`. **That manifest and its reader live only on
  `trial/integration-2026-09-24b`**, not on this branch. Without them,
  `npm run check:migrations` reports thirteen duplicate-sequence findings.
- **This branch changed `src/migrations/check.ts`**: the `sequence/gap` rule now
  asks the **ledger** rather than the positions, so a branch whose numbers jump
  from 0539 to 0577 (because 0540–0576 were written elsewhere and are already
  applied) is not reported as having destroyed history. The dangerous case keeps
  its own precise finding — `checksum/missing` reads the ledger directly and
  names the file. **`human-simulation-harness` also changed this file**; see §6.
- **Baseline:** `migrations/baseline/baseline.json` lists every migration by
  name. Any add or rename leaves it stale and a fresh install arrives missing
  the difference — silently, because the office looks complete. That mechanism
  lives on `claude/fresh-install-onboarding`, which is **not** in the three
  branches named for this integration; see §12.

---

## 5. API and contract changes

### 5.1 `hq-api` gateway — sections added

`output` (`hq_output`, `p_output_id`) · `assigned` (`staff_on_project`,
`p_project_id`) · `pulse` (via 0578's `public` wrapper).

> **A merged page asks for `assigned` and `output`.** Until the merged gateway
> is deployed, `verify:hq` fails one check: `missing: assigned, output`. That is
> a deploy step, not a defect.

### 5.2 `hq-api` gateway — actions added

`contact_update` · `contact_archive` · `contact_photo` · `document_link` ·
`document_order_set` · `document_order_reset` · and the document review pair.
Each names required arguments; the projection lives in `app.hq_*`.

### 5.3 Authentication semantics — the important one

- `Authorization: Bearer <hq.api_token>` — a machine. Unchanged.
- `Authorization: Bearer <supabase access token>` — a person. Verified with
  Supabase, then against `public.office_members`, cached 60 s on success only.
- **401** means refused. **503** means could not check. A client that treats
  every non-200 as "signed out" will sign people out on a throttle.
- `web/studio/office.js` clears the credential **only on 401**. This is the
  contract the 503 depends on.

### 5.4 `signin` function (new)

`POST` with `{action}`: `link` (public, rate-limited by Supabase to one per
address per minute), `link_for_operator` (requires the office key), `refresh`,
`whoami`. Refuses any origin not in `SIGNIN_ALLOWED_ORIGIN`.

### 5.5 Front-end configuration contract

`window.HQ_API` is the seam. `config.js` is written as
`window.HQ_API = window.HQ_API || '…'` **on purpose** — an explicitly set value
(a test, a wrapper page) wins; a deployment names the office when nothing else
has. Sibling addresses are derived, never written down again.

### 5.6 Voice

`voice` and `voice-token` gained the session-aware path. The experiment runs its
own copies under `voice-basecamp` / `hq-api-basecamp` (ADR-0043's slug
arrangement) so the default Team HQ cannot be affected by anything this branch
deploys.

---

## 6. High-risk files and overlap

### `supabase/functions/hq-api/index.ts` — **YES, heavily touched (+486 lines)**

`human-simulation-harness` and `production-reliability` also touch it (+60 lines
each, the same `kickWorker` change).

**This is the most dangerous file in the integration, and it has already bitten
once.** The conflict region **ends mid-function**: the incoming side finishes at
`else keepAlive(kick)` and the shared line after the marker is the single `}`
that closes whichever function came last. Concatenating the two sides leaves
`kickWorker` unterminated. **`tsc` cannot see it — it does not typecheck Deno
edge functions.** Only `npx biome ci supabase/functions/hq-api/index.ts` does.

**What must survive from this branch:** the `Verdict` type; `askUpstream` with
its 429 retry; `sessionAllowed` returning `'unknown'` for anything that is not a
401/403; the membership read never reading a failure as a "no"; the call site's
`401` / `503` split; the `output` and `assigned` sections; the seven actions.
`tests/gateway/a-throttle-is-not-a-refusal.test.ts` asserts these as properties
over the source and has been proved able to fail.

### `scripts/check-leaks.ts` — **YES, touched**

`human-simulation-harness` also touches it.

**Same shape one layer down, and it also already bit.** The line immediately
above the conflict marker is a bare `/*`, so both sides' comment bodies hang off
one opening and the first side closes it. Concatenating leaves the second side's
prose as **SQL**. It parses perfectly as TypeScript — it is inside a template
literal — and announces itself much later as
`42601: syntax error at or near "no"` from a query nobody changed.

**What must survive from this branch:** the `harness_contacts` count and its
failing branch.

### Other dangerous files

| File | Why |
|---|---|
| `src/migrations/check.ts` | both branches changed it; this branch narrowed `sequence/gap` to ask the ledger, the candidate added the collision manifest reader. A textual merge can silently keep one and drop the other |
| `scripts/e2e.ts` | the gate list. Additive, but a dropped line silently removes a check |
| `package.json` | 61 new scripts here, ~40 there. Additive both times, no key overlap observed, but a botched merge loses whole suites |
| `web/studio/office.js` · `chat.js` · `call.js` · `session.js` · `backend.js` | the auth and unconfigured-office behaviour. A revert compiles and is wrong |
| `web/studio/app.js` | ~13,900 lines before this branch; a template-literal file where **a backtick inside an HTML comment ends the string** and renders nothing |
| `scripts/deploy/*.ts` | deployment logic, including which slug and which target |
| `CLAUDE.md` | both branches appended traps; additive, keep both |

---

## 7. Important commits

| SHA | Purpose | Why integration should care |
|---|---|---|
| `a1a2b53` | **A person signs in; a machine presents a key** (ADR-0043, 0580, 0581) | the whole auth model. If this is lost the product goes back to pasting a bearer token into a browser |
| `3c940b9` | **ADR-0048** — the dashboard resolves its own office; `config.js`, `backend.js`, `check:backend-ref` | removes a hardcoded office from six modules. The fallback is tempting to restore |
| `499c086` | **A throttle signed people out** — three verdicts in the gateway | a security/reliability fix in the most-conflicted file in the repository |
| `f116a22` | `verify:basecamp-chat` rewritten for the session architecture | carries **two product fixes**: the empty-office crash in `bc/shell.js`, and `chat.js` clearing the session on 401 |
| `d846c0a` | chat/call refuse honestly when unconfigured | four call sites; without them a page posts to its own origin |
| `4545c03` | the office seam for seventeen browser suites | without it those suites pass or fail depending on whether somebody ran a deploy on that machine |
| `658e744` | arrangement per person **and** surface (0582) | ADR-0021's guarantee |
| `168f298` | document ordering (0583) | four orderings, one custom order, shared between two views |
| `f5df583` | an output can be read (0584) | |
| `490959d` | three basecamp tokens that resolved to nothing | small, real CSS defects |
| `d77dfd4` | **Final gate state: 354/0 and 511/0** | the last full-gate run on this branch alone; a useful "before" marker |

---

## 8. Verification evidence

### Measured at this branch's HEAD (`129a706`), today

```
npx vitest run                145 files, 2277 tests, all passing
npm run lint                  exit 0   (biome ci — fails on FORMATTING too)
npm run typecheck             exit 0
npm run check:templates       exit 0
npm run check:secrets         exit 0   1835 files, 96 env values
npm run check:backend-ref     exit 0   nothing under web/ names an office
npm run check:migrations      exit 0
npm run check:pressable       exit 0
npm run check:gateway-wrappers exit 0
npm run smoke                 exit 0   every route renders, nothing thrown
npm run verify:basecamp-covered / -classes / -actions   exit 0
npm run verify:ui             54/54    (real Chromium, three device profiles)
npm run verify:talk           40/40
npm run verify:tasks-ui       52/52
npm run verify:hq             46/47    (the one failure is §5.1's deploy step)
npm run check:tokens          exit 1   831 findings — SEE §10, THIS IS EXPECTED
```

### Measured on the integration candidate `trial/integration-2026-09-24b`

This branch's HEAD commits are in that tree verbatim.

```
npx vitest run                195 files, 3130 tests, all passing
npm run fresh:zero-state -- --preconditions
                              608/608 from a database dropped immediately before
basecamp:gate   (15 steps)    home 45/45 · routes 64/64 · journey 55/55 ·
                              keyboard 31/31 · preservation 26/26 · states 64/64 ·
                              docs 27/27 · look 21/21 · chat 30/30 ·
                              controls: 423 pressed, 0 unpressable, 0 findings
basecamp:gate2  (26 suites)   board 35/35 · todos 30/30 · cards 24/24 ·
                              back 20/20 · contacts 31/31 · voice 16/16 ·
                              settings 34/34 · words 22/22 · affordance 16/16 ·
                              torture 31/31 · failures 39/39 · touch 28/28 ·
                              voicenote 36/36 · livevoice 28/28 · drive 26/26 ·
                              photo 11/11 · waiting 17/17 · running 9/9 ·
                              sources 9/9 · team 12/12 · addsource 10/10 ·
                              signin 17/17 · todos-live 25/25 ·
                              arrangement-live 8/8 · docorder-live 21/21
readiness gate                all 57 checks run individually; mytasks 89/89
```

### Production probes and browser evidence

- The gateway deploy probes all four reachable answers on every deploy:
  **no credential 401 · a wrong one 401 · the office key 200 · a fake session 401.**
- **CORS from the real deployed origin, in real Chromium** — which a
  server-side fetch can never prove, because it sends no `Origin`: gateway and
  voice reachable and returning 401; **`signin` correctly BLOCKED** from the
  preview origin, confirming the allow-list was not widened.
- The **default Team HQ** rendered in a real browser: 200, 1,914 characters, 7
  rail items, **0 page errors**, no basecamp experience, untouched.

### Especially important to rerun AFTER integration

In this order — see §13 for the full checklist:

1. `npx biome ci supabase/functions/hq-api/index.ts`
2. `npx vitest run tests/gateway/a-throttle-is-not-a-refusal.test.ts`
3. `npm run check:backend-ref -- --prove-it`
4. `npm run verify:basecamp-chat -- --prove-it`
5. `npm run check:leaks`

---

## 9. Test limitations — read this before trusting §8

**Be suspicious of the green.** Specifically:

- **The whole of `basecamp:gate` runs against a stub office.** `verify:basecamp-chat`
  replaces the gateway, the sign-in function and the voice function with
  fixtures. It proves the **page's** half. The office's half is proved
  separately by `verify:basecamp-signin` and the `-live` suites.
- **The `'unknown'` verdict cannot be driven from here.** Provoking it needs the
  upstream identity service to fail, which cannot be arranged without changing
  production. It is held by a test **over the source**, which is strictly weaker
  than driving it. That test *was* proved able to fail by putting the boolean
  collapse back.
- **`verify:hq` is 46/47 by design right now** and will stay so until the merged
  gateway is deployed. Do not "fix" it in code.
- **`verify:another-go` gave two different verdicts against one commit** —
  9/10 then 10/10, minutes apart. It gates a model-mediated decision on a hard
  zero. Filed as [#367]. Treat a single red run of it as unproven, not as merge
  damage.
- **Free-tier model nondeterminism** runs under several backend suites. A suite
  that runs an office turn can legitimately differ between runs.
- **Suites that sign in must not be run back to back.** Supabase issues one
  magic link per address per minute; a burst produces links that sign nobody in.
  `signIn` now waits out the window and retries up to three times, and prints
  every retry — but a very tight loop can still exhaust it.
- **The Management API throttles.** Running two database suites concurrently
  produced `ThrottlerException: Too Many Requests` and a false failure. **Run the
  backend suites sequentially.**
- **A cold preview deployment loses races.** Several suites' fixed selector
  waits were lengthened and made to print what the page had; a fresh deployment
  still needs a warm-up request.
- **Sandbox Chromium cannot load webfonts**, so any typographic observation from
  a sandbox capture is unreliable.
- **`verify:basecamp-chat` runs `SUBJECT=source` in gate1** — the working tree,
  not the deployed bytes.
- **What no suite here proves:** the OAuth round trip for connecting Google or
  Notion (it cannot be driven from this sandbox and must not be faked), and the
  redirect leg of sign-in at an origin that is not on the allow-list.

---

## 10. Known defects and deferred work

### A. Genuine defects — **pre-existing, NOT introduced by this branch**

Each was measured at `d77dfd4`, this branch's state before the final pass, and
gave the identical verdict there. **None is in any gate**, which is why nobody
knew. Filed as [#368].

| Suite | Result | Fails |
|---|---|---|
| `verify:modules` | 14/16 | *the panel draws the modules the office holds — nothing* |
| `verify:offline` | 22/23 | *a first failure shows the outage strip — (no strip)* |
| `verify:inverse` | 24/26 | two checks, not yet diagnosed |

### B. Accepted limitations

- **`check:tokens` reports 831 findings on this branch and this is expected.**
  Basecamp declares its 67 tokens under `:root[data-experience='basecamp']`;
  the checker on `main` and on `human-simulation-harness` only counts
  unconditional `:root`. **`check:tokens` is in `human-simulation-harness`'s
  gate, so the merged tree will be red until the experience-aware checker comes
  across.** It is written: `trial/integration-2026-09-24b`, commit `c6f74cf`.
  **This is the most likely way integration will look broken when it is not.**
- `verify:hq` 46/47 until the merged gateway is deployed (§5.1).
- The voice page's mint URL is substituted at deploy time; run from source with
  no substitution it refuses honestly rather than working.

### C. Deferred enhancements

- `docs/basecamp/pending` holds items raised during the mission and not built.
- The 0573 `pg_proc`-join hazard is filed as [#369] with a suggested check; it
  belongs to the migration corpus, not to this branch.

### D. Unrelated technical debt

- `verify:disconnect` was once destructive against live Slack credentials; it is
  wrapped now, but it is not in any gate.
- Several bespoke test servers write a `200` header before reading the file. One
  was fixed here (`tasks-ui`); others may share the shape.

### E. Left for a later branch

- The provider half of Add Source (Google/Notion OAuth).
- Anything about the **default** Team HQ's own design. This branch only removed
  the hardcoded office from it and did not otherwise touch its appearance.

---

## 11. Deployment and configuration

### Canonical production — untouched by this branch, and probed today

| | |
|---|---|
| `https://ai-team-hq.vercel.app` | the default Team HQ · **200**, renders, 0 page errors |
| `functions/v1/hq-api` | the shared gateway · **200** |
| `functions/v1/signin` | **200** |
| `functions/v1/voice`, `voice-token` | **200** |

**This branch has never deployed to any of them.**

### Experimental — this branch's own, and it must keep working

| | |
|---|---|
| `https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app` | the stable experiment alias · **200** |
| `functions/v1/hq-api-basecamp` | the experiment's gateway · **200** |
| `functions/v1/voice-basecamp` | **200** |

### Temporary — retire once integration is proven

| | |
|---|---|
| `functions/v1/hq-api-integration` (v6) | the isolated gateway the merge-readiness pass drove · **200**. Nothing points at it but the preview |
| `agentic-team-hq-basecamp-o7falu7ke-…vercel.app` | a preview with its own hostname; **moved no alias** |

**Keep both until integration is proven.** They are the only deployed copy of
the integrated gateway, and they are the reference the regression checklist in
§13 compares against.

### Configuration

- **`web/studio/config.js` is generated and gitignored.** `npm run config:site`
  writes it; `deploy:hq` and `deploy:preview` run it first. **A deploy that
  skips it ships a dashboard that does not know which office it belongs to** —
  and says so honestly rather than guessing.
- Environment: `SUPABASE_PROJECT_REF` (defaults to this office, per F-009),
  `HQ_API_SLUG`, `HQ_VOICE_SLUG`, `VERCEL_PROJECT`, `VERCEL_PREVIEW`,
  `SIGNIN_ORIGIN`, `HQ_API_OVERRIDE`, `BASECAMP_SITE`, `LIVE_HOST`, `SUBJECT`.
- Function secrets set by `deploy:signin`: `HQ_API_TOKEN`,
  `SIGNIN_ALLOWED_ORIGIN`. **The allow-list is a production authorisation
  boundary; do not widen it to make a preview convenient.**
- Secrets live in the Supabase Vault. No secret is in the repository.

---

## 12. Cross-branch risk — hypotheses, not permissions

Comparing against `claude/human-simulation-harness` and
`claude/production-reliability` only, as instructed.

### First, two facts that remove most of the risk

- **`production-reliability` is an ancestor of `human-simulation-harness`**
  (`git merge-base --is-ancestor` confirms). Merging it separately can only
  invent conflicts.
- **`main` is an ancestor of `human-simulation-harness`** as well.

Migration counts: `main` 533 · `production-reliability` 542 ·
`human-simulation-harness` 604 · this branch 547.

### Overlap this branch actually has with `human-simulation-harness`

Measured: the files both change relative to `main` are exactly —

`CLAUDE.md` · `package.json` · `scripts/check-leaks.ts` · `scripts/e2e.ts` ·
`src/migrations/check.ts` · `supabase/functions/hq-api/index.ts` ·
`tests/migrations/check.test.ts` · and the fourteen migrations, **which are
byte-identical on both**.

| Risk | Hypothesis |
|---|---|
| **Gateway** | `hq-api/index.ts`: their `kickWorker` vs this branch's auth verdicts and sections. The conflict cuts through a function body. **Highest risk in the integration.** |
| **`check-leaks.ts`** | the conflict cuts through a comment and turns prose into SQL |
| **`src/migrations/check.ts`** | both changed the checker. This branch narrowed `sequence/gap`; the candidate added the collision manifest. A textual merge can keep one and drop the other |
| **`check:tokens`** | **it is in their gate and will be red on the merged tree.** Not a defect in either branch; the fix is `c6f74cf` on the candidate |
| **Migrations** | none expected — identical files. But the **thirteen duplicate numbers** will be reported by `check:migrations` unless `migrations/collisions.json` and its reader come across |
| **Deployment** | both expect `deploy:hq`. This branch additionally requires `config:site` to have run, or the page ships unconfigured |
| **Auth** | if their branch introduced any other caller of `allowed()`, it must handle three verdicts, not a boolean |
| **Persistence** | arrangement and document order are new tables/functions of this branch; no overlap observed |
| **Worker/jobs** | this branch adds no job kind. Their `kickWorker` fires after any successful POST — including this branch's seven new actions, which is correct and untested here |

### A branch not named in this integration

`claude/fresh-install-onboarding` (604→ baseline, `check:fresh`,
`scripts/fresh/**`) is **not** in the three branches named. The merge-readiness
candidate included it, and three findings depend on it — the fresh-install
baseline, migration `0595` (the schema carried Grant's Telegram chat id in a
function body), and twenty zero-state preconditions. **If it is genuinely out of
scope, those findings do not apply and the candidate is not the right model for
this integration.** Worth confirming before using
`docs/integration/merge-plan-2026-09-24.md`, which assumes three branches
*including* it.

---

## 13. How to detect if integration broke this branch

**The acceptance contract, in priority order.** 1–5 are non-negotiable.

### Priority 1 — does the gateway still parse and still refuse correctly

```bash
npx biome ci supabase/functions/hq-api/index.ts      # tsc CANNOT catch this
npx vitest run tests/gateway/a-throttle-is-not-a-refusal.test.ts
grep -n "type Verdict" supabase/functions/hq-api/index.ts
grep -n "503" supabase/functions/hq-api/index.ts
```

Inspect by eye: `kickWorker` is terminated; `sessionAllowed` returns
`'unknown'` for anything that is not 401/403; the call site answers **401 for
`'no'` and 503 for `'unknown'`**; the `output` and `assigned` sections and the
seven actions are present.

### Priority 2 — is the office still resolved rather than hardcoded

```bash
npm run check:backend-ref
npm run check:backend-ref -- --prove-it     # must go red, then green
grep -rn "supabase.co" web/ | grep -v config.js   # must find NOTHING
```

### Priority 3 — does the session architecture still work end to end

```bash
npm run check:templates && npm run smoke
SUBJECT=source npm run verify:basecamp-chat            # expect 30/30
npm run verify:basecamp-chat -- --prove-it             # must go red, then green
npm run verify:talk                                    # expect 40/40
```

Inspect: `web/studio/session.js` exists; `chat.js` calls `session.forget()` on
401; `office.js` clears **only** on 401.

### Priority 4 — did the harness honesty survive

```bash
npm run check:leaks          # must RUN; a 42601 syntax error means the
                             # comment-cutting conflict was mis-resolved
npm run check:gateway-wrappers
npm run check:pressable
```

### Priority 5 — the product itself

```bash
npm run lint && npm run typecheck && npx vitest run
npm run verify:ui            # expect 54/54
npm run verify:tasks-ui      # expect 52/52
npm run basecamp:gate        # 15 steps
npm run live:mirror && npm run basecamp:gate2    # after deploying
```

### Priority 6 — migrations and fresh install

```bash
npm run check:migrations
npm run verify:wrappers
```

### What to inspect rather than run

- `package.json` — 40 `verify:basecamp-*` scripts, `basecamp:gate` (15 steps),
  `basecamp:gate2` (27 steps), `config:site`, `check:backend-ref`.
- `.gitignore` — `web/studio/config.js` must still be ignored.
- `scripts/e2e.ts` — `check:backend-ref` still in the gate list.
- `docs/adr/0043`, `0047`, `0048` present.

### Expected failures that are NOT integration damage

```
check:tokens         831 findings, unless c6f74cf came across   (§10.B)
verify:hq            46/47 — missing: assigned, output, until deploy  (§5.1)
verify:modules       14/16   pre-existing   [#368]
verify:offline       22/23   pre-existing   [#368]
verify:inverse       24/26   pre-existing   [#368]
verify:another-go    intermittent            [#367]
```

---

## 14. What must not be resurrected

1. **The office token in the user experience.** No paste box, no
   `npm run hq:token` in a user-facing path, no `#bc-token`, and the word
   "token" nowhere in the sign-in strip. `verify:basecamp-chat` asserts the
   property.
2. **The pairing flow.** 0577's table and four functions, and the Telegram-tap
   approval. Built, driven, and deliberately removed by 0581.
3. **The hardcoded gateway fallback** —
   `window.HQ_API || 'https://<ref>.supabase.co/functions/v1/hq-api'` — in any
   of `app.js`, `office.js`, `session.js`, `chat.js`, `call.js`, `data.js`,
   `index.html` or `web/voice/index.html`. It is tempting because it makes a
   local page work. `check:backend-ref` refuses it.
4. **A boolean `sessionAllowed` / `allowed`.** Any collapse of "could not ask"
   into "not valid" re-creates the sign-out-on-throttle bug.
5. **`if (!who.ok) return false`** in any form, and its sibling on the
   membership read.
6. **`chat.js` clearing only `hq.token`** and leaving `hq.session` behind.
7. **`project()` ending `?? PROJECTS[0]`** without a null guard — an office with
   no projects cannot draw.
8. **Posting to an unconfigured office.** `fetch('')`, `fetch(VOICE + '/turn')`
   and `fetch(MINT)` with an empty base all resolve against the page's own
   origin.
9. **Arrangement in `localStorage`.** ADR-0021 and 0582.
10. **A to-do interface calling a task writer directly.** ADR-0047.
11. **`origin = 'linked'`** for a Drive document — the word the table has is
    `source` (0536).
12. **A browser suite relying on a fallback office** instead of naming one at
    the seam.
13. **Widening `SIGNIN_ALLOWED_ORIGIN`** to make a preview or a test convenient.

---

## 15. Out of scope — absence here is not integration damage

This branch deliberately did **not** attempt:

- any change to the **default** Team HQ's design, layout or behaviour, beyond
  removing the hardcoded office address;
- the **provider half of Add Source** — connecting Google or Notion is an OAuth
  round trip that cannot be driven from this sandbox and must not be faked;
- backend behavioural work: routing, delegation, the coherence gates, the job
  queue, duties, the evaluator. That is `human-simulation-harness`'s;
- production reliability work: backups, transport, recovery. That is
  `production-reliability`'s;
- the **fresh-install** story — baseline, `check:fresh`, zero-state
  preconditions. That is `claude/fresh-install-onboarding`'s, and see §12;
- migration-corpus hygiene: the thirteen collisions are **recorded**, not
  resolved;
- replacing `web/hq/index.html` or revisiting ADR-0019;
- `verify:modules`, `verify:offline`, `verify:inverse` — found red, filed,
  not fixed;
- any change to `main`.

---

## BRANCH INTEGRATION CONTRACT

### Branch

`claude/basecamp-team-hq`. The last commit of work is
**`129a7069d69f8614cfbd88db1473687621c874fc`** (`129a706`) and that is the SHA
to verify against; the branch tip is the commit that added this document, whose
diff against `129a706` is this file and nothing else. Clean, pushed, 139 commits
of work ahead of `main`, 0 behind.

### Purpose

The experimental Basecamp-inspired Team HQ at `/basecamp`, and the
authentication work that turned out to be inseparable from it: a person now
signs in with their own Supabase Auth session verified against
`public.office_members`, while a machine still presents `hq.api_token`, and the
dashboard resolves which office it belongs to at deploy time instead of carrying
one project's gateway in six modules. Along the way it added contacts that can
be corrected, Drive files that become documents by reference, a board
arrangement that follows the person between devices, document ordering, readable
outputs, browser voice notes, and forty verification suites in two gates.

### Must survive

The gateway's **three verdicts** — 401 for a refusal, **503 for could-not-check**
— and the two-question session check (Supabase **and** `office_members`). The
narrow `signin` origin allow-list. No office address anywhere under `web/`, and
`check:backend-ref` in the gate. A refused session cleared by **every** door. An
unconfigured page refusing honestly rather than posting to its own origin. An
office with no projects still drawing. Arrangement in Supabase, keyed by person
**and** surface. A to-do interface that talks to a port. A Drive file linked by
reference, one document per file.

### Must not return

The office token in the user experience; the pairing flow 0581 removed; the
hardcoded `supabase.co` fallback in any of the seven front-end files; a boolean
`allowed()`; `chat.js` clearing only `hq.token`; `?? PROJECTS[0]` without a null
guard; arrangement in `localStorage`; `origin = 'linked'`; a widened
`SIGNIN_ALLOWED_ORIGIN`.

### High-risk surfaces

**`supabase/functions/hq-api/index.ts`** — the conflict ends mid-function and
`tsc` cannot see the damage; only `biome ci` can.
**`scripts/check-leaks.ts`** — the conflict cuts through a comment and turns
prose into SQL that parses fine as TypeScript.
Then `src/migrations/check.ts`, `scripts/e2e.ts`, `package.json`,
`web/studio/{office,chat,call,session,backend}.js`, `web/studio/app.js`,
`scripts/deploy/*`. The thirteen duplicate migration numbers — **record them,
never rename them.**

### Authoritative verification

```bash
npx biome ci supabase/functions/hq-api/index.ts
npx vitest run tests/gateway/a-throttle-is-not-a-refusal.test.ts
npm run check:backend-ref -- --prove-it
SUBJECT=source npm run verify:basecamp-chat        # 30/30
npm run verify:basecamp-chat -- --prove-it
npm run verify:talk                                # 40/40
npm run verify:ui                                  # 54/54
npm run check:leaks                                # must RUN, not 42601
npm run lint && npm run typecheck && npx vitest run
npm run basecamp:gate
```

### Known pre-existing problems

`check:tokens` 831 findings (the checker cannot model an experience; the fix is
`c6f74cf` on `trial/integration-2026-09-24b`) · `verify:hq` 46/47 until the
merged gateway is deployed · `verify:modules` 14/16 · `verify:offline` 22/23 ·
`verify:inverse` 24/26 (all three [#368], measured identical at `d77dfd4`) ·
`verify:another-go` intermittent ([#367]). **None of these is merge damage.**

### Deployment dependencies

Before the integrated system can become canonical: `npm run config:site` must
run (it is inside `deploy:hq` and `deploy:preview`) · `npm run deploy:hq` — the
merged gateway carries the auth fix and the two sections the merged page asks
for, and `verify:hq` stays 46/47 until it does · `npm run deploy:signin` if the
origin list changes · `npm run fresh:baseline` **only if**
`claude/fresh-install-onboarding` is in scope. Keep `hq-api-integration` and the
preview standing until integration is proven.

### Integration warning

**The two conflicts in this branch's most-shared files do not fail loudly.**
`hq-api/index.ts` cuts through a function body and `check-leaks.ts` cuts through
a comment; both merge textually, both compile, and both are wrong. One renders
the gateway unparseable in Deno while `tsc` reports nothing; the other turns
English into SQL inside a template literal and surfaces hours later as
`42601: syntax error at or near "no"`. **Run `npx biome ci` on the gateway and
actually execute `npm run check:leaks` before believing the merge succeeded.**

---

BRANCH HANDOFF COMPLETE — READY FOR INTEGRATION ANALYSIS

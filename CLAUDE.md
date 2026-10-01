# Working on this repository

**Read this first.** It is the standing brief for any agent — or human — picking
this project up. Nothing here depends on a conversation you cannot see.

## What this is

An agentic AI office for Grant Rogers. Eight staff agents (Claire, Chief of
Staff; Tom, Strategy; Emma, Research; Daniel, Finance & Data; Marcus,
Operations; Ruby, Growth; Oliver, Communications; Grace, Quality & Risk) take
jobs from a Postgres queue, act on his real projects, and reach him through
Telegram, Slack, a voice call and a web dashboard.

## Where the project is: GRANT HUMAN BETA

**The backend certification campaign is COMPLETE. It ended GREEN on 15
September 2026 and Grant accepted the verdict.** Do not reopen it, and do not
start another development campaign, until he asks.

| | |
|---|---|
| **Certified candidate** | commit `63c5a26`, worker **v391**, **375** migrations |
| **Model** | `openai/gpt-oss-120b` → `qwen/qwen3.7-flash` → `mistralai/mistral-small-3.2-24b-instruct` → free tier |
| **Verdict and evidence** | `docs/testing/backend-acceptance-verdict-2026-09-15.md` |
| **What GREEN does NOT claim** | the same document, and `docs/testing/green-blocker-ledger.md` |

Four final examinations earned it, each written after the last, each committed
unrun against its own freeze, none recycled. Three found real systemic defects
(#246, #247, #248, #249, #254, #255); the fourth found none and scored 17/18,
its one failure an expectation the authoring session had written itself.

### Policy phase: CLOSED, 1 October 2026

**ORIGINAL ARCHITECTURE AUDIT: CLOSED.** Technical findings were closed at `4053433f`; Grant's seven final policy
decisions (Vikunja, Slack channels, Notion, Slack rotation, learning, cross-project retrieval, proactive autonomy) were
implemented in 0640-0646 and verified in production. `docs/policy/FINAL-POLICY-IMPLEMENTATION.md` is canonical and
ADR-0059 records the decisions; `docs/architecture-run-5/DECISION-389.md` is the superseded options paper. The next
phase is multi-user architecture research against this clean baseline; it has not begun.

### The standing rule that replaces the campaign

**Do NOT write another synthetic final examination.** Four were justified
because each of the first three found a genuine systemic defect. A fifth would
be testing because more testing is imaginable, which is not a reason, and Grant
has said so explicitly.

What replaces it is beta. **Real usage is now the primary source of behavioural
findings**, and a genuine failure Grant hits during normal use is worth more
than any corpus, because nobody wrote it to find anything.

When he reports one:

1. **Investigate before theorising.** Read the canonical evidence — the job
    row, the output body, the impediment, the routing decision. This file
    records several occasions where a confident reading of a symptom was wrong
    and one query settled it.
2. **Classify it**, in his words: SYSTEMIC PRODUCT DEFECT · LOCAL PRODUCT
    DEFECT · HARNESS DEFECT · EXPECTED STOCHASTIC VARIANCE · ENVIRONMENT /
    PROVIDER FAILURE. Give the evidence for the classification, not just the
    label.
3. **Fix it at the appropriate abstraction.** #249 and #254 are the cautionary
    pair: three defects filed separately were one defective abstraction, and
    the fix for it repeated the same mistake one layer deeper. Ask whether the
    thing that failed is an instance or a class *before* patching the instance.
4. **Convert it into a permanent regression.** Not the sentence that failed —
    semantic neighbours of it, and the negative controls that prove the fix did
    not buy recall with precision.
5. **Run the affected gates**, and say which ones and what they returned.

Reopening certification needs evidence from real use that the verdict was
wrong — not a new idea for something that could be probed.

**Context compaction is expected and is NOT a stopping condition.** After one:
reread this file, then `docs/AUTONOMOUS-RUN.md`, reconstruct the backlog from
the issues it names, identify the current checkpoint and continue. Do not hand
control back to Grant because a compaction happened.

## Reading order

| Document | Role |
|---|---|
| **this file** | how to work here — standing instructions and traps |
| **`docs/AUTONOMOUS-RUN.md`** | ⭐ **read this second.** Where the work is, the current checkpoint, and how to continue after a compaction |
| [GitHub Issues](https://github.com/granterogers/agentic.team.grant/issues) | **all actionable work.** Milestones M0 → v1.0 |
| `docs/testing/behavioural-run-ledger.md` | ⭐ **the behavioural discovery programme** — objective, passes, stopping criteria, outstanding investigations. Read it before resuming that work |
| `docs/HANDOFF.md` | current state, summarised |
| `docs/testing/backend-acceptance-verdict-2026-09-15.md` | ⭐ **the GREEN verdict, what it rests on, and what it does not claim** |
| `docs/testing/green-blocker-ledger.md` | every blocker this campaign opened and how each closed |
| `docs/integration-assessment-2026-09-10.md` | what exists, what is missing, what was decided |
| `docs/spec/frontend-build-prompt-2026-09-10.md` | ⭐ canonical frontend requirements — **v3, Autonomy** |
| `docs/spec/project-dashboard-ia-2026-09-10.md` | ⭐ canonical project IA — hierarchy, assets, the relational graph |
| `docs/spec/github-persistence-brief-2026-09-13.md` | ⭐ the communications brief — verbatim; tracked by #191 |
| `docs/spec/ux-qa-v2-2026-09-15.md` | ⭐ **UX QA v2 — the operative QA standard, verbatim.** Two-level governance, the visual-coherence gate, the QA-harness audit, the eight-hour first-run contract |
| `docs/spec/ux-qa-governance-2026-09-14.md` | the earlier UX QA standard — verbatim; still valid as the detailed 1A/1B/1C escalation text v2 subsumes |
| `docs/spec/backend-acceptance-2026-09-14.md` | ⭐ the canonical backend acceptance standard — verbatim; **backend readiness before human testing** |
| `docs/spec/backend-intelligence-breadth-2026-09-14.md` | ⭐ routing, delegation and intelligence-breadth stress testing — verbatim; tracked by #231 |
| `AI_TEAM_HQ_MASTER_SPEC.md` | ⭐ canonical system requirements |
| `docs/adr/` | why each material decision was made |
| `docs/architecture.md` | vendor bindings |

**Issues are the backlog. This file and the handover are not.** If you discover
work and do not do it, open an Issue — never a TODO comment, never a note in
prose, never only a sentence to Grant.

Grant, 10 September 2026, restating it:

> *"such things (REQUEST, improvement, etc) should always be placed in the
> github issues so nothing is list"*

That covers **requests he makes in chat**, not only defects you find. A feature
he asks for gets an Issue at the moment he asks for it, before you start
building it — because the risk is not that you forget it this hour, it is that
the conversation is compacted and it is gone.

This has already happened. His *PROJECT DASHBOARD — INFORMATION ARCHITECTURE &
UX* specification arrived mid-turn, was compacted before it reached the
transcript on disk, and was unrecoverable. A reconstruction stood in for it, a
day of frontend work was built against the reconstruction, and roughly half of
that work was specifically wrong — the tab names, the chat's addressing, the
import step. Grant re-sent the original and both specs are now verbatim.

**Two rules follow, and they are cheap:**

1. Persist a requirements document the moment it arrives, before doing anything
   with it. A file write costs seconds; rebuilding against a paraphrase costs a
   day.
2. **Never condense a requirements document.** The frontend prompt was stored as
   a tidied summary and read as canonical for a week. Convert the markup, keep
   every word. If you are writing "the gist is", stop.

---

## Grant's standing instructions

These are his words, and they are not negotiable. Several were learned the hard
way; the parenthetical says what went wrong.

### Autonomy

> *"Just take some autonomy. It's on GitHub, so if anything blows up, we can
> always go back. Just keep going with minimal intervention from me."*

> *"Stop asking me such stupid questions."*

Make routine calls yourself and say what you chose. Reserve questions for
decisions where proceeding either way would be unsafe or would waste
substantial work. §31 of the frontend spec is explicit: **treat an avoidable
request for manual configuration as a design failure.** Prefer API → CLI →
automated configuration → manual UI.

> *"I want to reduce my dependence on Claude or another coding interface for
> maintaining and extending the system."*

This is the long-range goal that outranks most others. A capability that exists
only as a script an agent runs is a capability Grant does not have. Prefer
making the office able to do a thing over doing it for him.

### The words for things

> *"from now on, let's call our source of truth for projects, our **dashboard
> projects**. So then we know where we're referring to Supabase. So that's
> where everything eventually lives, and it can interact with third party
> sources like Google Notebook, and it can pull things in, pull things out."*

**A "dashboard project" is a row in `public.projects` in Supabase.** It is the
source of truth. A NotebookLM notebook, a Notion database, a Drive folder are
things a dashboard project is *attached to* — never the project itself.

Use his words. "Project" alone is ambiguous when NotebookLM also calls its
notebooks projects, and that ambiguity has already produced three notebooks for
one intention.

### Confirm before destroying

> *"You should always check before making any destructive action with me."*

> *"Please don't assume I wish to create a new project — this is a large task
> and should always be confirmed."*

### Be explicit

> *"Always be explicit with instructions!!! Never assume I just know what you
> are referring to. Also include full instructions each and every time with
> URLs, steps to follow, etc."*

Report status in red / orange / green with specific URLs.

### Secrets — absolute

> *"Do not expose secret values in logs, commits, reports, test output or
> chat."* · *"NEVER expose: access tokens; secret values; API keys; raw
> credentials."* · *"Do not ask me to paste secrets into chat. Use the
> project's established secret-management mechanism."*

Secrets live in the **Supabase Vault**. Never in the repository, never in a flat
environment variable, never printed. `npm run check:secrets` must stay clean and
runs before every push. The vault export sends file and passphrase as two
separate Telegram messages with nothing printed and nothing written outside a
temp directory.

*(Grant once pasted a GitHub PAT into chat. It was stored as `github.read_token`
marked COMPROMISED and he was asked to rotate it. **As of 2026-09-10 it has not
been rotated** — see Issues.)*

### Messaging him

> *"I only get messages from the chief of staff."*

`telegram.only_chief_speaks` is **true**. Everyone else still does the work and
still writes output — the dashboard shows it all — they just do not send.
Distinct from `telegram.direct_to_grant`, which decides *which chat*.

> *"I want you to set up notifications... so that I can... rather than me having
> to launch into Claude, you send a push notification."*

`npm run notify -- "..."` reaches his phone through the pager bot.
`--decision` buzzes; anything else is silent. Use it when blocked or when there
is something genuinely worth looking at. Do not narrate progress to it.

### Speed, without quality loss

Grant, 14 September 2026 — a standing instruction, not a one-off:

> *"Optimize for **minimum wall-clock time to a verified, production-quality
> result**. Speed must come from eliminating unnecessary work, parallelising
> independent work, batching operations, and reducing tool/context overhead —
> **never from reducing reasoning quality, implementation quality, testing,
> verification, security, or completeness**."*
>
> *"FASTEST VERIFIED PATH, NOT FASTEST OUTPUT."*

The tie-breaks he stated, in his order: **correctness wins over speed.
Security wins over speed. Required testing wins over speed.** Where two
approaches are of equal quality, take the faster one.

What this changes in practice here:

- **Batch and parallelise.** Independent reads, searches, suites and API calls
  go in ONE message with several tool calls. Only serialise what genuinely
  depends on a previous result.
- **Do not re-scan what is already known.** Search narrowly before searching
  the repository. Read the part of a large file the question needs.
- **Cut narration, not verification.** He asked for fewer running commentaries
  on routine steps — report results, decisions, risks and blockers. Everything
  in `Before you push` still runs.
- **Fail fast.** Prove the API, library or integration can support the approach
  before building on it. Diagnose a failure before retrying it — this file
  already records what three blind retries cost (#183, #197, #209).
- **Fewer interruptions.** Routine, reversible calls are made and stated, not
  asked about. Ask only when genuinely blocked, when a credential or external
  approval is needed, or when a consequential choice cannot be inferred.
- **Done means implemented → tested → verified → checked for regressions →
  documented.** Code written is not done.

**This does not license background work.** Read it with the next section:
parallel means several tool calls in one message and independent suites run
concurrently — it does not mean hiding work Grant asked to see in the
foreground. The two instructions agree: batching is faster AND visible.

### Everything in the foreground

> *"I don't like you doing background tasks. Please have all tasks that are
> being performed shown in the foreground."*

Do not background a command. The only reason to reach for it is the shell's
two-minute default timeout, and the fix for that is an explicit longer timeout
on the call — up to ten minutes — not hiding the work.

The commands that actually need it: `verify:ui` (three device profiles in a real
browser, ~3 min), `verify:talk` (~2 min), a full `deploy:*` with its probes, and
`npm test` on a cold start. Give those a real timeout and let them print.

If something genuinely cannot finish inside ten minutes, split it — run one
device profile at a time, deploy one function at a time — rather than
backgrounding it.

### Watching the work

> *"I want to see what it is that you're doing... so that I can pop into the
> application and see what it is you're doing."*

> **Always paste the image URLs into the reply as well.** Grant: *"I can't see
> anything.. you will always have to give me the image links each time to
> judge."* A screenshot that only exists on the build page is a screenshot he
> has to go and find, and he will not. The `--shot` upload prints the public URL
> — put every one of them in the message, described, so he can click and judge
> without leaving the conversation.

`npm run step -- "what you are doing" --towards M0` opens a step;
`--finish <id> --produced "..."` closes it; `--shot path.png` attaches a
screenshot. It surfaces at **ai-team-hq.vercel.app → What Claude is building**.
Use it for anything that takes more than a few minutes, and **always attach
screenshots for visual work** — a sentence about spacing is worth nothing.

### UX QA, in proportion to risk

**Superseded in part, 15 September 2026.** `docs/spec/ux-qa-v2-2026-09-15.md` is
now the operative QA standard and is stored verbatim. It keeps everything below
— the two levels, the escalation by blast radius, the proportionality rule — and
adds three things this section did not have:

1. **A visual-coherence gate that is allowed to fail QA on its own.** Green
   tests, working buttons, no axe violations and no overflow can still be
   **UX QA FAIL** if the product is ugly, incoherent, bloated or
   typographically poor. Both a FUNCTIONAL UX PASS and a VISUAL COHERENCE PASS
   are required.
2. **The QA harness is itself a subject of the audit.** Prove a detector can
   fail — synthetic failure, confirm red, restore, confirm green — and never
   commit the defect.
3. **Design-system inventories**: typography, colour, components, geometry,
   information density, and space as a measured metric.

The wording rule is unchanged: *"run UX QA"* means proportionate Level 1;
*"RUN FULL UX QA"* means Level 2.


Grant supplied the **Master UX QA Governance Prompt** on 14 September 2026. It is
stored verbatim at `docs/spec/ux-qa-governance-2026-09-14.md` — **the canonical
QA document**, and the only one. §61 of it specifies the standing rule below, in
these words:

> *"Whenever user-facing UI/UX changes, automatically run proportionate
> real-browser UX QA against the affected surfaces using the master UX QA
> standard. Escalate by blast radius. Do not run the full deep audit for every
> small change. Run FULL UX QA when explicitly requested or when shared/high-risk
> changes make scoped verification insufficient. No UI work is complete without
> rendered, interacted-with and visually inspected evidence."*

Its own summary of itself: **do the smallest QA that can credibly prove the
change is good.** A minor local visual fix should not trigger a systems
marathon; a navigation rewrite should. *"The objective is not maximal test
volume. The objective is maximal confidence per unit of effort."*

**Which level.** Pick by blast radius, not by how long the diff is:

| Level | The change | Minimum |
|---|---|---|
| **1A** | small and local — spacing, one card, one icon, one empty state, local copy | smoke and static checks, render the affected screen, **open the image**, the relevant device (and the other one if responsive CSS can be touched), no overflow on that surface, the interaction still works, targeted regression |
| **1B** | interactive — a button's behaviour, a form, sheet, dialog, navigation, the composer, the project switcher, the command bar, a Settings control, a connection flow | all of 1A, plus real browser interaction, keyboard where it matters, console and network, the relevant control audit, desktop **and** phone, the failure/empty/degraded state, targeted accessibility |
| **1C** | shared — a shared primitive, the rail or header, shared responsive CSS, theme or tokens, the modal system, shared agent/project identity, cross-screen navigation | all of 1B, plus a sweep of the affected routes, layout verification, a phone overflow scan, representative screenshots, both themes if theme-sensitive, reduced motion if motion-sensitive, broader regression |
| **2** | the full deep audit | the whole document |

**Escalate to Level 2** when Grant asks for it; when the blast radius is hard to
bound; when shared navigation or layout primitives, global CSS, tokens or
themes, accessibility infrastructure, the conversation architecture, or
auth/connection/credential flows change; when the browser QA tooling ITSELF
changes; when a significant redesign lands; when repeated regressions say scoped
QA is not enough; or when preparing a milestone.

**How to read what he says**, from §§59–60:

- *"run UX QA"* · *"check the UX"* · *"QA these UI changes"* → **proportionate**.
  Inspect the diff, decide the surfaces, pick 1A / 1B / 1C, run it, fix, retest,
  file Issues, report concisely. **Do not** reach for the deep audit.
- *"run full UX QA"* · *"deep UX audit"* · *"full frontend audit"* ·
  *"bulletproof the UX"* · *"run the master QA"* → **Level 2**.

The line that outranks the rest of it, and the one this repository has already
paid for repeatedly:

> *"NO GRAPHICAL CHANGE IS COMPLETE SOLELY BECAUSE IT COMPILES, RENDERS, OR
> PASSES A STATIC CHECK."*

---

## Hard constraints

| Constraint | Detail |
|---|---|
| **Cost** | ~£0/month. Supabase free tier (500 MB database, 1 GB storage), Vercel Hobby, OpenRouter free models. Do not add a paid dependency without naming the cost and a free alternative. |
| **GitHub Actions** | **Off.** Every schedule and push trigger was removed 2026-09-08 on Grant's instruction after 1,800 of 2,000 free minutes went to a five-minute cron: *"stop using github actions completely please, find another way to do thing... for any process."* `workflow_dispatch` remains. Checks run before every push in the authoring session instead. See Issue #17. |
| **No new auth system** | One bearer token (`hq.api_token`), constant-time compared. Reuse it. |
| **Channel adapters may only translate** | §5 of the master spec. Every surface writes to `inbound_commands` and asks the canonical layer. An adapter that decides is a bug. |
| **Frontend stack** | No React, no Next.js, no bundler, no build step. Hand-written HTML on Vercel. Deliberate — ADR 0002, ADR 0011. Changing this needs an ADR and evidence, not preference. |
| **Which frontend** | **`web/studio` is the product**, and **Team HQ is what it renders at every address**: `/`, `/p/<slug>/<tool>`, `/tasks`, `/activity`, `/search` (**ADR-0051**, #382). `/basecamp/…` and `/studio/…` redirect there. The older studio is kept, unlinked, at `/classic`. The word "Basecamp" must never reach a person: `npm run check:branding` is in the gate. Internal names (`bc/`, `verify:basecamp-*`, `experience === 'basecamp'`) stay. `web/hq/index.html` is deleted (ADR-0019, #68). |

---

## Before you push

```bash
npm run lint && npm run typecheck && npm run test
npm run check:migrations && npm run check:secrets && npm run check:templates
npm run verify:wired                                            # if UI changed
npm run verify:hq && npm run verify:ui && npm run verify:talk   # if UI changed
npm run shots                                                   # capture web/studio
```

`npm run shots` renders the prototype in real Chromium at 1440×900 and iPhone
14, in both themes, and writes twelve PNGs to `.out/`. It is the capture half of
§14A's loop — **it does not pass or fail anything.** The critique is done by
opening the images and looking at them, and then attaching one to a build step
so Grant can see it too.

> **Webfonts do not load in the build sandbox.** Chromium there cannot reach
> `fonts.googleapis.com` (curl can — it is a proxy difference), so every capture
> shows the fallback face. Any observation about typography from a sandbox
> capture is unreliable until the fonts are self-hosted. Tracked as an Issue.

Deploys probe themselves and fail when the probe fails:
`npm run deploy:hq` (page + hq-api) · `deploy:worker` · `deploy:voice` ·
`deploy:telegram` · `deploy:slack` · `deploy:mcp`.

`npm run migrate` applies plain SQL from `migrations/`. **679 applied** (0666 is the latest).

## Asking the office about itself

```
npm run measure          # what the office actually does — real traffic only, appended
npm run levels           # where every tool sits on #234's six levels
npm run breadth          # which of #235's coverage dimensions have no cases at all
npm run session -- --list          # the #237 conversation sessions
npm run session -- --only <name>   # run one, resumable; --reset starts it again
npm run session -- --report        # score every turn recorded
npm run verify:routing-heldout     # routing against cases it has never seen
npm run gate             # the checks that must pass, check:icons among them
npm run verify:lately    # Recent activity: the fold, the counts, no harness rows (#14)
npm run verify:upload    # a dropped file, through the DEPLOYED gateway (#126)
npm run slack:add-scope -- channels:join   # a Slack scope by manifest, not by browser
GO=lately npm run probe -- '.main'         # measure a rail destination, not a project tab
npm run check:icons      # every project-mark default names a mark the page can draw (#221)
npm run check:ownership        # every table has an ownership class; a derived table proves its owner (multi-user P0)
npm run check:system-secrets   # human-integration credentials are read through ONE resolver (multi-user P1.2)
npm run check:machine-key      # the office key reaches no person-defaulting function that is not pinned (P1.5)
npm run check:callers    # no NEW capability ships with nothing that calls it (#72)
npm run check:consumed   # no table the product writes is one nothing can ever read (#72)
npm run space            # now walks the home board's panels too, and reports spare room (#267)
npm run verify:rules             # a correction becomes a standing rule, only on a press (#147)
npm run verify:routing-quality   # a model is chosen on what it has done, per kind (#127)
npm run verify:extract           # tasks pulled out of a document, and taken back (#130)
npm run tier1            # the intelligence corpus (tier1:fast omits the 30-minute judge)
npm run mutate -- "…" --wants <slug>   # semantic variants of a request, printed not appended
npm run q  -- "select …" # a query as a table
npm run qq -- "select …" # a query whose output is not truncated — use it for function bodies
```

`measure` is the one that would have caught what nobody noticed for months: five
of eight agents never selected, and `delegation_depth` 0 across every real job.
It reports real and harness traffic separately, always.

---

## Looking is not measuring

`npm run shots` renders the prototype and writes PNGs. It tells you a layout is
wrong. It does not tell you which box is the wrong size, and reading the CSS
back to yourself is how you convince yourself it is right twice in a row.

```
npm run probe -- '.wrow' '.wout' '.woutfile'
TAB=chat npm run probe -- '.composer' '.thread'
```

prints the computed box, display, position and overflow of each selector on the
real page. Reach for it the moment a capture looks wrong — it found a 660px gap
in one run that three readings of the stylesheet had not.

```
npm run wide
```

names what is pushing the page sideways on an iPhone, on every project tab,
innermost element first. `npm run shots` only tells you THAT the phone
overflows. This tells you which element, and it filters out the two things that
always look like overflow and never are: SVG children (their geometry ignores
the viewport that clips them) and anything inside a scroll container or a fixed
element.

```
npm run space
```

answers the OTHER question a capture raises: not "how big is this box" but
"which of forty boxes is spending the room". Per panel it prints the header's
share of the panel and whether the #108 fade is actually on; per container, how
much is empty; and on a phone, how far down the first pixel of real content is
with everything stacked above it named. It reports and fails nothing.

Reach for it before believing anything you think you can see in a PNG. #85's
first pass off the capture produced four findings and **three were wrong** — a
rail that is 880 of 900px used, a fade that was already on at `opacity: 1`, and
a "clipped" title with 20px of clearance. Two of the three would have been
"fixed". Look at the PNG to decide WHERE to measure; never to decide WHAT is
wrong.

---

## Traps this repository has already fallen into

Each of these cost real time. They are here so they cost it once.

- **`git checkout <file>` throws away uncommitted work in that file.** Used to
  undo a two-line scratch edit in `web/studio/app.js`, it also discarded an
  hour of unrelated changes sitting in the same file. Copy the file first
  (`cp x /tmp/x.bak`) or stash; never reach for `checkout` on a file you are
  in the middle of editing.
- **A backtick inside an HTML comment inside a template literal ends the
  string.** *This now has a check: `npm run check:templates`, which parses
  every `web/**/*.js` **as an ES module** and refuses a backtick inside an
  HTML comment. `node --check` alone is not enough — without a `.mjs`
  extension it parses in script mode, which is how a broken `app.js` once
  passed a green check.* `web/studio/app.js` is one long set of template literals, and the
  explanatory `<!-- … -->` comments live inside them. Writing `` `data-blocked` ``
  in one of those comments terminated the template, and the file became
  unparseable — which renders NOTHING, and announces itself as a capture run
  timing out on a selector that cannot exist. Use plain words inside HTML
  comments in this file. `npm run smoke` catches it in three seconds; run it
  after every edit to `app.js`.
- **A media query adds no specificity, so where you write it decides whether
  it works.** `web/studio/studio.css` has a `@media (max-width: 860px)` block
  near the top and base rules for `.callbtn`, `.brandline`, `.team` and
  `.navitem.proj` three hundred lines below it. Every phone rule written in
  that upper block was silently overridden by source order, and the phone
  layout stayed broken through a full capture run that reported no errors.
  **Phone overrides go at the END of the stylesheet.** Bitten twice — the
  earlier one was `.navgroup`.
- **A CSS class name defined twice is a bug waiting for the right element.**
  `.stage` was the small status pill on a contact card AND the desk's pannable
  surface with `min-height: 420px`. It was harmless for weeks because
  `min-height` does not apply to a non-replaced inline element and every pill
  was an inline `<span>`. The in-tray put one in a grid, it was blockified, and
  it pushed the rest of the row 660px down the page. Second time: `.kind.doc`
  collided with the card class `.doc` and became `k-pdf` / `k-doc` / `k-made`.
  Grep for a class name before you invent it, and prefer a prefix
  (`.wrow`, `.deskstage`) over a good short word.
- **`Buffer` is a Node global and not a Deno one.** Edge functions run in Deno.
  Use `Uint8Array` and `TextEncoder`. Bitten three times —
  `channels/telegram.ts`, `slack/signature.ts`, `voice/inbound.ts`.
- **`create or replace function` does not replace a function whose argument
  list changed** — it creates a second overload and calls become ambiguous.
  `drop function` by exact signature first. Check the **public wrapper** too:
  it is the half that silently drops a new parameter.
- **PostgREST only exposes `public`.** Every `app.*` RPC needs a public wrapper.
- **Guessing column names wastes hours.** Query `information_schema` first.
  Real ones that have caught people: `jobs.state` (not `status`),
  `responsibilities.period_minutes`, `documents.content`, `deliveries.error_code`,
  `outputs.body` with no `project_id` (join through `jobs`).
- **`min(uuid)` does not exist.** Use `(array_agg(x order by y))[1]`.
- **A project's slug is derived from its NAME, not from `p_ref`.** In
  `app.hq_create_project(p_name, p_connector, p_ref, p_display, p_force)`,
  `p_ref` is the CONNECTOR REFERENCE. A verify teardown keyed on `p_ref`
  matched nothing and left six real, active projects in Grant's project list.
  Delete order is forced by ADR-0014: **archive, then attachments, then the
  project** — the trigger fires on the attachment delete.
- **A teardown that matches nothing looks exactly like a teardown that
  worked.** Assert it left nothing behind, in the suite, as a check.
- **A suite that creates a REAL project must remove it, and `npm run
  check:leaks` is what makes that true.** Thirty archived debris projects
  accumulated because `purge:fixtures` can never collect them — `is_fixture` is
  GENERATED and matches only `fixture-%`, `verify-%`, `ledger-proof-%`, and a
  suite testing anything that EXCLUDES fixtures cannot use those names. So the
  convention is: **a feature that filters fixtures gets a real subject you tear
  down; everything else gets a fixture name.** Tear down through
  `app.project_delete(slug)`, which refuses a project holding documents or jobs
  and does ADR-0014's order for you. Nineteen of the thirty carry a job and can
  therefore never be deleted at all — a job cannot be removed, so the project
  cannot — which is why the check fails only on debris that CAN be swept.
- **A suite that names its subjects `fixture-…` cannot test anything that
  excludes fixtures.** `app.resolve_project_by_name` filters
  `not p.is_fixture`, and `is_fixture` is GENERATED from the slug — so
  `verify:identity` spent eleven failing checks on a feature that works. Use
  real subjects and tear them down (Issue #45).
- **Extensions live in the `extensions` schema.** A function with
  `search_path = ''` must qualify `extensions.similarity`.
- **A server-side `fetch` sends no `Origin`,** so it cannot detect a CORS
  misconfiguration. The voice call was dead for weeks while every probe passed.
  Probe with the real page origin.
- **Test fixtures are not failures.** `jobs.is_fixture` and
  `projects.is_fixture` exist because harness traffic was reported to Grant as
  the office collapsing. Read health from `app.office_health()`.
- **Notion:** API version `2026-03-11`; `in_trash`, not `archived`; databases
  are containers for data sources; pages parent to `data_source_id`; queries go
  to `/data_sources/:id/query`. Notion exposes **no teamspace** on any version.
- **A document we wrote into a connector is not new material.** See
  `documents.mirrors_document_id` (0169).
- **`opacity: 0` hides pixels, not layout.** A Configure button invisible until
  hover still reserved its 90px in every staff card, leaving ~50px for the
  text: eight agent names wrapped one character per line. `smoke`,
  `verify:layouts` (38 states) and `verify:controls` all passed — bad wrapping
  is not overflow, not low contrast, not small type and not a dead control.
  Found by opening the PNG. Use `position: absolute` or reserve the space
  deliberately. Issue #67; the same shape as #34.
- **A class is only styled where its rule says it is.** `.m` is muted and
  12.5px because of `li .m, .meta { … }` — the first half of that selector needs
  an `li` ancestor. Used outside a list it renders at full body size and full
  ink, so a meta line under a heading read as a second heading. Grep for the
  rule, not just the class name, and check the ancestor it assumes.
- **A verification that looks somewhere other than where the user looks passes
  for the wrong reason.** Three instances in one day, which is what makes it a
  pattern rather than three bugs. `verify:ui` fed the staff tab `hq_staff()`
  while the page requests `hq_team()`. `verify:skills` tested the table and the
  function separately and the bug lived only in the gap. And `npm run shots`
  renders `web/studio` while `verify:ui` drives `web/hq/index.html`, so a week
  of visual work went into a file that is not the one deployed (#68). Before
  trusting a green suite, ask what it is pointed at.
- **A verification that feeds the page the wrong payload passes.**
  `verify:ui` mapped the staff tab to `hq_staff()` while the page asks for
  section `team`, which the API serves from `hq_team()` — a different shape
  entirely. The tool grid, the bot picker and the procedures all rendered as
  nothing, and a card with nothing in it has no overflow, no small type and no
  bad contrast. It passed for months. The moment it was corrected it found a
  68×24 touch target. Check what the PAGE requests, not what the section is
  called.
- **A trigger you do not know about silently undoes your write.**
  `projects_touch_updated_at` sets `updated_at` to now on every update, so
  backdating it to manufacture a stale project is reverted by the statement
  doing the backdating. Three checks failed against a branch that was correct.
  `select tgname from pg_trigger where tgrelid = 'public.x'::regclass` before
  concluding the code is wrong.
- **`backdrop-filter` breaks `position: fixed` inside it.** It establishes a
  containing block, so a fixed child anchors to that element instead of the
  viewport — a bottom navigation bar rendered across the top of the page.
  `filter`, `transform`, `perspective` and `will-change` all do the same.
- **A wired control can still never receive the event.** The panel headers'
  Narrower, Wider and Remove buttons sit inside `[data-grip]`, the drag handle.
  Pressing one fired `pointerdown` on the grip, a drag began, `pointerup` saved
  and redrew, and the DOM the click was travelling towards no longer existed —
  eighteen buttons that looked fine and did nothing. `verify:wired` cannot see
  this (the handlers exist and the attributes are looked up); only
  `verify:controls`, which presses and watches, can. That is why both exist.
- **The studio never stops moving**, so Playwright's "element is not stable"
  check can never pass inside it — `breathe()` and `scatter()` run for as long
  as the page is open. Hit-test the element yourself
  (`document.elementFromPoint` at its centre IS the element) and then
  `click({ force: true })`. And a view transition paints an overlay over the
  WHOLE page for ~900ms, during which every `elementFromPoint` returns the root.
- **A sweep that presses every control will press the one that hides the
  others, and the page will remember.** `verify:controls` reported 91 of 182
  desktop controls as unpressable — the same thirteen on every route, the
  entire left rail — for weeks, while the phone leg reported 2. The cause is
  one press: the chevron at the top left collapses the sidebar, and the studio
  stores that in `localStorage` because a person who collapses a sidebar means
  it. Every rail control after that press is behind `main`. The buttons still
  RESOLVE — a collapsed rail clips them rather than removing them, so they keep
  a box and Playwright counts them as visible — which is why it read as an
  actionability mystery rather than a shut sidebar. The audit's `openRail()`
  was called at NAVIGATION, which is one press too early. There is a
  `shutDock()` beside it that exists for exactly the same reason and had
  already been learned once (#103).
- **The rule above the two rules above: `catch {}` around a Playwright click
  throws away the only thing that says why.** #183 spent three attempts and two
  ruled-out hypotheses on that skip count, because the actionability log was
  being discarded. The log names which of the five checks failed and, for
  occlusion, which element is in the way:

      - element is visible, enabled and STABLE
      - scrolling into view if needed
      - <main class="main">…</main> intercepts pointer events

  "Element is not stable" and "intercepts pointer events" have completely
  different causes and completely different fixes, and a bare count cannot tell
  you which you have. Two of the three fixes tried for #183 — force-clicking,
  and a taller viewport — were reasonable, changed nothing, and were reverted;
  the log found it in one run. **91 pressed / 91 unpressable became 289 / 1,
  and none of the 198 newly-reached controls was dead** — which is the other
  half of the lesson: a blind audit is not necessarily hiding defects, and you
  cannot know that until it can see.
- **A control that nothing looks up is a control nothing can have wired.**
  `verify:controls` presses things, costs minutes per route, and only covers
  what it can reach. `npm run verify:wired` walks twenty-one screens, collects
  every `data-*` attribute on every visible button and link, and fails if any
  source file never queries it. It found `data-hire` — the other half of a
  roster feature whose `staff_retire` had existed alone since 0079 — which a
  full press-everything audit had never seen, because that audit runs without
  a token and the button is only drawn for a writer (#74).
- **The key you DERIVE is not the key you must CHECK.** Hiring someone called
  "Claire" derived the slug `claire`, found no collision, and would have put a
  second Claire on the roster — because Claire's slug is `chief-of-staff`.
  Same shape as the project trap below it. Check the human-readable field too.
- **A NOT NULL column that defaults to `''` makes every `coalesce` on it dead
  code.** `documents.produced_by` was `not null default ''`, so
  `coalesce(d.produced_by, 'The team')` — written in four readers, including two
  the studio calls — could never fire, and a document the office made rendered
  with a BLANK origin line where a name should be. Latent since 0175 and only
  reached when #20 became the first thing to set `origin = 'made'` on a row the
  gallery shows. It is 0177's own argument about `connector = 'none'` in a
  second column: a sentinel satisfies the constraint and lies. Fixed in the
  column (0284), not in the four readers. Grep for `default ''` before writing a
  coalesce against a text column.
- **A check that asserts the MECHANISM breaks on a correct refactor.**
  `verify:identity` asserted that the index `project_aliases_normalised_uniq`
  existed *by name*, with a comment saying a future change that dropped it
  should fail here. 0282 dropped it deliberately — replacing it with a trigger,
  because the predicate has to read `projects.status` and a partial index may
  only reference its own table — so the check fired on a correct change and
  said "THE UNIQUE INDEX IS GONE". Assert the property (a phrase is claimed by
  at most one project Grant can be routed to), not the artefact that currently
  implements it.
- **A refusal for the wrong reason looks exactly like the rule working.** The
  replacement check above did a raw insert and asserted only that *something*
  threw. It threw because the column is `alias`, not `phrase` — and reported a
  PASS. Then it threw on a generated column, and passed again. Assert on the
  message (`refused.includes('already routes to')`), or go through the
  sanctioned writer, which names what it refused and why.
- **Loosening a constraint does not loosen the function that pre-checks it.**
  0282 replaced a global unique index with a trigger scoped to ACTIVE projects,
  to release 561 routing phrases held by retired probes. `app.add_project_alias`
  — the only writer anybody calls — does its own pre-flight conflict check with
  no `status` filter, so every one of those phrases was still refused and 0282's
  headline benefit was unreachable from the day it shipped (0293). #72's shape
  in the hardest place to see it: both halves correct alone, only their
  disagreement wrong. When you change a constraint, grep for the function that
  checks the same thing in advance to give a better error.
- **A teardown that matches a PREFIX only covers subjects named to fall under
  it.** `verify:identity` tears down `identity-proof-<run>%`. A subject added
  later as `Identity proof rival <run>` derives the slug
  `identity-proof-rival-<run>`, which is outside that prefix — three of them
  reached Grant's project switcher. Name the extra subject so the run stays
  where the prefix expects it (`Identity proof <run> rival`), rather than
  widening the teardown.
- **A swallowed error on a write nobody reads back is indistinguishable from a
  feature that was never built.** `consultations` had never held a row and the
  code that writes it looked finished: it passed a `text[]` and a slug where
  two UUIDs belong, raised on every single hand-off, and ended
  `.catch(() => undefined)`. §9's whole question — is convening specialists
  worth it — was unanswerable for weeks because of one silent catch. If a write
  is allowed to fail without failing the job, record the failure somewhere
  (`app.cannot`), and prefer an RPC that takes the vocabulary the CALLER has
  over an INSERT that makes the caller know the column types.
- **An append-only ledger cannot be torn down, so a suite against it must
  write FIXTURES.** `job_impediments` refuses DELETE (§6), so `verify:proposes`
  writing real subjects left permanent rows proposing a tool called
  `verify-tool-mtwjh76u`. `is_fixture` is inherited from the job by trigger and
  `impediments_tally` excludes fixtures — so a fixture impediment is permanent
  AND uncountable, which is what a suite wants. The reader then needs the
  `p_include_fixtures` parameter the tally already had (0297) so the real path
  can still be driven. This is the OPPOSITE of #45's advice, and the deciding
  question is which one the thing under test filters.
- **A registry row can claim anything, so the claim needs a column that names
  what performs it.** `tool_permissions` listed `web.search`, level 0, ENABLED,
  with nothing in the repository implementing it — and `capabilityBrief` builds
  every agent's prompt from that table, so all eight were told they could search
  the web. #64 with the sign reversed, which is worse: being told NO about
  something possible costs a feature request; being told YES about something
  impossible costs the work, silently, and Grant finds out when nothing arrives.
  `delivered_by` plus a check constraint (0298) makes the claim checkable.
  Disable such a row, never delete it: a listed gap can become a proposal
  (#49), a deleted one cannot.
- **`public.skills` and `public.job_impediments` are append-only, so a suite
  RETIRES its subject.** `app.retire_skill` is the withdrawal path, and using it
  in teardown is better than a DELETE would have been — it exercises the
  mechanism a person actually has. Assert that the subject is no longer LIVE
  (`skills_live`, or excluded from the tally), never that the row is gone.
- **An audit that has never opened a surface says nothing about it.**
  `verify:layouts` walked seven project tabs and reported 38 green states for
  weeks; it had never opened the settings sheet, which is eight more screens
  and the only place in the product with irreversible controls on it. Pointed
  at one settings tab it found three defects in the first run — an ink token
  failing WCAG AA at 12px, and 2,857px of a phone sheet hidden behind an
  overlay scrollbar with no affordance, which is #108 still live. Before
  trusting a count of green states, ask what the audit can actually reach.
- **A decorative transform makes a correct control measure wrong.** With a
  sheet open the studio blurs the shell and scales it to 0.994 so the sheet
  reads as nearer. Every rect behind it is multiplied, so a 44px button
  measures 43.74 and a touch-target audit reports it — on a surface with
  `pointer-events: none`, which nobody can touch. An audit run over a page with
  something in front of it must scope itself to the thing in front.
- **`scrollbar-width: thin` does not create a gutter on a touch device.**
  Chromium keeps an OVERLAY scrollbar there — zero reserved width, invisible
  until you are already scrolling — and `scrollbar-gutter: stable` is ignored
  for overlay scrollbars, so it fixes the desktop and leaves the phone exactly
  as broken. The affordance that works on both is a sticky fade element at the
  end of the scroll container: no JavaScript, no class to toggle, and with
  nothing below it there is nothing to see, which is precisely when there is
  nothing to announce.
- **A CONTROL goes stale when the thing it controls for changes.**
  `verify:hq` proved its tool refusal discriminated by revoking and re-granting
  `web.search`. 0298 disabled `web.search`, because it was claimed on every
  agent's sheet with nothing behind it — so the control asserted that a
  DISABLED tool could be re-granted and went red on a correct change. Same
  shape as asserting an index by name. Pick a control subject the change under
  test cannot move, and say in the comment why that one.
- **A JSONB column rendered with an escaper says "object Object".**
  `suggestions.because` holds the numbers the noticing pass counted, not a
  sentence — the name reads like prose and it is not. The first draft of the
  governance page put `esc(s.because)` on Grant's screen. Query
  `information_schema` for the TYPE before writing the renderer, the same rule
  as for the column name.
- **A denormalised flag on an append-only table is a fact frozen at insert.**
  `job_impediments.is_fixture` is COPIED from the job by trigger, and §6's
  triggers then refuse UPDATE — so when the job's attribution is corrected
  afterwards, the copy stays wrong for ever. Five rows of `verify:proposes`
  debris sat on Grant's Governance page for an hour saying Ruby had tried and
  could not do `probe-need-j4je9xrc` eight times, which is the harness-traffic
  trap on the surface built to make the office legible. Join to the thing that
  can still tell the truth (0303).
- **When two sources disagree and one is append-only, ask which direction each
  can lie in — `coalesce` assumes they are symmetric and they rarely are.**
  0303's fix read the job first and the frozen copy as a fallback, and put two
  rows BACK on the page it was written to clear: their ledger copy said fixture
  and their job, named `impediment-proof-…`, said real. Both flags can
  truthfully say "harness traffic" and neither can be trusted to say "real", so
  the rule is `or`, not `coalesce` (0304). The asymmetry is what makes it safe:
  a witness that can only ever exclude cannot hide a genuine finding.
- **A check that asks whether a list is an ARRAY passes while the list is
  wrong.** `verify:governs` asserted `Array.isArray(tried_and_could_not)` for
  all eight agents and was green throughout the hour the probe rows were live.
  Assert the shape of what is IN it — and against a moving target, assert the
  property rather than a count: "no name matching probe/fixture/verify" holds
  for ever, "zero walls" fails the day #49 starts working.
- **A migration is not a deploy.** 0283 taught `syncNotion` to skip Notion
  containers and deleted the three that existed. Fifteen minutes later
  `duty:notion-sync` put all three back, because the deployed worker had been
  built before 0283 and was still running the old path. The fix was in the
  repository and not in the thing that runs. After a migration that changes
  behaviour a HANDLER depends on, deploy the handler — and CLAUDE.md already
  said this once, about nine hourly jobs and a worker older than the handler.
- **Postgres NESTS block comments, so a slash-star inside one opens another.**
  Writing the glob for the web folder inside a SQL comment produced
  "unterminated /* comment" from a comment that visibly had an end. The
  companion of the backtick trap, in the same sentence, in the same hour —
  and `npm run check:templates` covers the web folder only, so neither is
  caught in `scripts/`.
- **A pre-condition shared by two suites is a coupling.** `verify:slack` and
  `verify:worker` both refuse to run while any job is live — correctly, because
  dequeue is global — and neither cancels the jobs it creates. Alone each
  passes; in a full pass whichever runs second fails on the first one's debris,
  and it fails as "22/26" rather than as "the queue was dirty". Suites are
  written and run one at a time, so this class of defect only exists once
  somebody runs them all (#184).
- **`is_fixture` on a JOB does not imply a fixture PROJECT, and the sweep
  assumed it did.** `purge:fixtures` retired orphaned jobs by matching the
  PROJECT's slug — but #45's rule sends any suite testing something that
  filters fixtures to use a REAL project, and `jobs.is_fixture` is GENERATED
  from `requested_by`. So fixture jobs on real projects were invisible to the
  sweep by construction, and twelve accumulated in the queue.
- **`jsonb_agg(x)` where `x` is a subquery alias aggregates the ROW, not the
  payload.** 0306 unioned two halves of a list as `(ord, at, v)` rows and
  wrote `jsonb_agg(x order by x.ord, x.at)`; every element came back as
  `{"ord":0,"at":"…","v":{…}}`, so the page read `kind` and `name` off the top
  level and got null for every field of every source. It did not throw and the
  array was the right LENGTH — a card with nothing in it, which has no
  overflow, no small type and no bad contrast. Name the column
  (`jsonb_agg(alias.v order by alias.ord)`), and keep the sort keys out of the
  payload.
- **A foreign key on a column an ADAPTER writes turns a bad value into a lost
  message.** `inbound_commands.addressed_to` references `staff`, so a slug
  naming nobody does not route badly — the INSERT fails and the whole turn
  comes back "could not record what you said". What Grant typed is gone
  because of who he addressed it to. The adapter now retries once with no
  addressee, which is translation failing honestly. Before writing user input
  into a column, check what happens when the value is wrong, not only when it
  is right.
- **Assert at the layer where the decision is actually made.** A first draft of
  `verify:addressing` asserted `jobs.recipient_agent` right after
  `enqueue_inbound` and failed — correctly, because enqueueing does not choose
  a person. `speaker()` does, when the job RUNS. The addressee reaching
  `pinned_config` is the enqueue layer's whole contribution, and asserting a
  decision before anything has decided is asserting the wrong thing at the
  wrong time.
- **Before writing an expression, check whether the table already computes
  it.** `public.documents` has a GENERATED, weighted tsvector column called
  `search` (title `setweight 'A'`, body `'B'`) with a `documents_search` index
  on it, and `app.search_documents` uses it. 0308 wrote
  `to_tsvector(title || content) @@ q` beside it — a sequential scan against an
  index that was right there, AND flat, so a document whose TITLE was the thing
  you searched for ranked equal with one that mentioned it once in passing.
  A computed expression that merely resembles a generated column is not the
  same expression and cannot use its index. Same rule as #169's about nouns,
  applied to columns.
- **A row list built twice is a list that will disagree.** The command bar's
  renderer and its keyboard picker each assembled their own; the comment on the
  picker already warned what that costs. Adding #37's second group to the
  renderer alone would have made every press below the first group open the
  wrong thing. One assembly, two callers.
- **A verify suite that skips the layer it exists for is worse than no suite.**
  `verify:search` first read `HQ_API_TOKEN` from the environment and reported
  "NOT CHECKED" when unset — and the HTTP layer is precisely where the defect
  lived: `app.search_documents` worked perfectly and had no public wrapper, so
  nothing with a browser could call it. The token is in the vault and
  `verify:hq` already reads it from there.
- **Do not store a fact you can already read.** `public.relations` — the typed
  edge table the IA document calls the point of the whole model — had never
  held a single row, while `documents.produced_by_job`,
  `mirrors_document_id`, `produced_by`, `document_collections`,
  `collections.for_task_id` and four columns on `tasks` held those same facts
  all along. Backfilling would have put every one of them in two places, and
  0303/0304 are six migrations away in this listing: the copy is the one that
  rots. `relations_of` DERIVES the edges a column holds and `relations` keeps
  only what no column expresses (0310).
- **A derived value must speak the stored vocabulary.** 0310's derived edges
  used verbs it invented — `wrote`, `holds`, `came from` — while
  `relations.verb` has a CHECK constraint listing ten words. Nothing failed and
  both halves read fine to a person, but a caller filtering
  `verb = 'assigned_to'` would have got the stored edges and silently missed
  every derived one. Five of the six mapped onto words already there; only
  `under` was genuinely new (0311).
- **A count-based assertion goes red the day the thing under test gets
  better.** `verify:assets` asserted a document had exactly 2 relations; 0310
  taught the graph to see a third that was always true. Assert the edges BY
  NAME. Same correction as the index asserted by name, and the third instance
  of it in this file.
- **`origin_channel` already has a word for the web dashboard, and it is
  `teamhq`.** 0313 wrote `'studio'` and was refused by
  `inbound_origin_channel_known`. ADR-0019 changed which FILES serve the web
  dashboard; it did not make it a different channel, and `DeliveryChannel`,
  `CHANNELS`, the callback router and the preference store all say `teamhq`.
  Widening the constraint would have made two words for one surface — which is
  what 0311 was spent undoing, three migrations earlier, in a different
  vocabulary.
- **`display: contents` is the way to wrap an element that is already
  absolutely positioned.** Wrapping `.talkabout` in a positioned span to hang a
  menu off it made the WRAPPER the containing block: the trigger left the
  card's corner, sat inline in the flow, and the three existing `.module` /
  task-row offset overrides all stopped applying. With `display: contents` the
  wrapper generates no box, everything above keeps working, and the menu
  anchors to the same element the trigger does.
- **A control that only exists while a menu is open is invisible to
  `verify:wired`.** It walks seventeen screens and collects the attributes it
  can SEE, so the six menu items were never checked — while `data-send-title`
  on the always-visible trigger was caught within seconds of being added. The
  audit is honest about what it reaches; do not read its silence about a
  popover as coverage.
- **An output can contradict its own metadata, and nothing was comparing
  them.** Claire sent Grant *"I pulled the project records. The db read shows
  five active projects: mtz08joe, …"* at 03:45. None of the five existed, and
  the row said `evidence: inferred` — the office KNEW nothing had been read and
  rendered that as grey caption text under a sentence claiming a database read.
  `metadataProblems` checked the labels against each other and never against
  the words. It takes the body now (#185). The same model had done it twice,
  five days apart.
- **A literal-string assertion is a wording lock, and rewording is the fix
  half the time.** #186 rewrote the Slack and Telegram provenance line into
  English and turned EIGHT checks red in one go — six unit tests, one live
  Slack check and one Telegram test — every one of them asserting `'confidence'`
  or `'no sources cited'` or `'not reviewed'` rather than the property those
  words carried. One (`not.toContain('—')`) was using a bare em dash as a proxy
  for the project footer, and the new line legitimately contains one. Fourth
  instance in this file.
- **Widening a display type can make a narrower one lie.** Sharing
  `provenanceLine` with the pager needed `PagerMetadata` to gain `sources` —
  and defaulting it to `[]` would have made every Telegram page say "nothing
  cited" about findings with five citations. `pager.page` already receives the
  whole `HandlerOutput`; pass the real value rather than a plausible default.
- **A fixture is named at creation, not at teardown.** `verify:slack` created
  `#slack_office_verification_fixture_12345678` and renamed it to `zz_test_…`
  when archiving — right thing, wrong MOMENT, because a crashed run never
  reaches teardown. Ten were sitting in Grant's Mentions above his four real
  channels. Slack refuses to rename or delete an archived channel, so that
  debris is permanent. Named `zz test slack …` from birth now, and
  `slack:tidy`'s pattern widened to match. Grant had already asked for this
  once — *"I don't want a bunch of weird alphanumeric channel names"* — and the
  answer that time was a cleanup rule, which only runs when the run finishes.
- **NULL is not equal to NULL in a unique index, so `on conflict` catches
  nothing.** `documents_one_per_external_ref` is unique on
  `(connector, external_parent_ref, external_ref)`; an imported output has a
  NULL parent, two nulls are distinct, and importing the same output twice made
  two documents. It took three migrations to make the conflict target MATCH the
  index (0317 guessed the columns, 0319 read `pg_indexes`, 0320 added the
  partial predicate) and a fourth to notice that matching it was not enough
  (0322). The fix is a narrow partial index whose columns contain nothing
  nullable — not `= ''`, which is 0177's sentinel again.
- **A comment claiming a property is worth nothing without a check behind it.**
  0317's own header said *"pressing Import twice imports one document"*. It
  did not, for five migrations, and `verify:import` found it on its first
  complete run.
- **The backtick trap is not only about HTML comments in `web/`.** Three times
  in one session: an HTML comment in `app.js`, a SQL comment inside a
  migration heredoc, and a SQL comment inside a template literal in
  `scripts/verify/import.ts`. `check:templates` covers `web/**` only, so the
  other two announce themselves as an esbuild parse error a long way from the
  cause. No backticks inside any comment that lives inside a template literal.
- **Copying another suite's teardown copies its assumptions.**
  `verify:import` cancelled its job the way `verify:proposes` does — but that
  job was `complete`, which is TERMINAL, and `enforce_job_transition` refuses
  complete → cancelled and is right to: a finished job did not later get
  cancelled. Cancelling is the teardown for a job left QUEUED. Check which
  state your suite actually leaves behind.
- **A class name that does not exist is not an error.** The import sheet was
  written with `.sheetin`, which appears nowhere in the stylesheet, so it had
  no surface, no border, no padding and no max-height — the header drew its own
  white block and the fields and both buttons sat loose on the page behind it.
  `smoke`, `check:templates` and `verify:wired` were all green. Found by
  opening the PNG, which is what §14A's loop is for.
- **Scratch scripts must live inside the repository** so `"type": "module"`
  applies; outside it, top-level `await` fails under CJS.
- **`opacity: 0` hides pixels, not layout — and it happened a second time, in
  the panel headers.** `.pctl`'s three 28px buttons are invisible until the
  panel is hovered, and they were setting the height of every panel header on
  the board: 53px for a 16px label, 18% of a 300px panel and 29% of the
  shortest one, six times over on one screen. Exactly #67, three months later,
  in a different file. `position: absolute` plus a reserved `padding-right` is
  the fix both times. **Grep for `opacity: 0` in a flex or grid row before
  believing the row's height.**
- **Reading a capture produces confident, wrong findings — `npm run space`
  exists because three out of four of mine were wrong.** #85's pass off the
  PNG claimed 350px of empty rail (the rail is 880 of 900px used), claimed the
  clipped panels had no affordance (the #108 fade is on at `opacity: 1` on
  every one) and claimed the phone's top bar sliced the project title (20px of
  clearance at `scrollTop: 0` — it is the capture's own scroll). Two of those
  three I would have "fixed", and one would have meant rewriting a mechanism
  that already worked. `probe` answers "how big is this box" when you already
  suspect an element; `space` answers "which of forty boxes is spending the
  room", which is the question a capture actually raises. Look at the PNG to
  find WHERE to measure, never to decide WHAT is wrong.
- **A phone rule can be decoration for a gesture the phone has switched off.**
  The board's *"Drag a panel by its title"* hint cost 51px on a 390px screen
  where `.panel` is `position: static`, the header is `cursor: default` and the
  resize controls are `display: none` — the drag is deliberately off there. Not
  merely clutter on the smallest screen: instructions to try something that
  cannot work. When a media query disables a behaviour, grep for the copy that
  teaches it.
- **#45's question has to be asked about the SPECIFIC thing, not about the
  suite.** `verify:history` used real project names on the reasoning that
  "`conversation_history` filters fixtures, so #45 says use real subjects".
  True of JOBS — it excludes `jobs.is_fixture` — and false of PROJECTS, which
  it never looks at. So the projects could have been fixtures all along, and
  instead **thirty-two archived debris projects accumulated in one afternoon**,
  which is #45's own pile being rebuilt by somebody quoting #45. Twenty-five of
  them are permanent: each gathered a job, a job can never be deleted, so
  `project_delete` refuses for ever. Ask the question about the column the
  reader actually filters, and grep the reader to find out which one that is.
- **A comment claiming a suite's traffic is harness traffic is worth nothing
  without a check.** `verify:addressing`'s header said "every job this writes is
  `requested_by` a `verify:` name, so `is_fixture` is generated true". It never
  was: the DEDUPE KEY began `verify:`, while `enqueue_inbound` composes
  `requested_by` as `<origin_channel>:<subject>` — so they were `voice:grant`,
  and **43 of them ran for real**, spending tokens and landing in Grant's
  health readings. It was also structural: `origin_channel` is constrained to
  four real surfaces and `kind` is hardcoded, so **no suite driving the real
  enqueue path could produce a fixture job at all** until 0342 added
  `%:verify-%`. If a suite believes its work is invisible, make it assert that.
- **An explicit preference makes the media query the audits were setting
  inert.** The studio's default scheme became `'dark'` (Grant asked for dark
  concrete), and an explicit choice writes `data-scheme` on the root — every
  dark block in `skins.css` is guarded `:not([data-scheme="light"])`, so
  `prefers-color-scheme` stopped deciding anything. Four audits were standing
  in for a light user through Playwright's `colorScheme`, which sets only that
  media query: `verify:layouts` reported 25 contrast failures on a correct
  change, and `npm run shots` wrote PNGs named `-light` that were dark. The
  wrong-payload trap with the sign flipped — red rather than green, which is
  the lucky direction and the only reason it was caught in one run. An audit
  asks for a scheme the way a person does, through the stored preference:
  `scripts/verify/seed-appearance.ts`. Before setting a browser-level signal in
  a test, check whether the product still reads it.
- **A resize event arrives after the layout has already moved.** #197's
  keyboard handling took four attempts and each was half of the real fix: pin
  on resize (but the handler held the thread node captured at wiring time, and
  a resize re-renders and REPLACES it, so `scrollTop` on a detached node moves
  nothing); look it up live inside the pin (but the GUARD still measured the
  captured node and bailed before pinning — half a fix reads exactly like no
  fix); ask the live node (but by then the box has shrunk around the old scroll
  position and every measurement describes the after). The answer is to REMEMBER
  the state continuously, on every scroll and every render, and consult the
  memory when the event fires. Anything you need to know about "before" has to
  have been recorded before.
- **A local `const` shadows a module namespace import, and the throw lands
  somewhere else entirely.** `const when = (iso) => … when.words(iso)` inside a
  render function resolved to its own binding and threw — while
  `settingsSheet()` was building its template, BEFORE `innerHTML` was assigned,
  so the previous pane stayed on screen and the symptom was "the Channels tab
  does nothing". Three runs were spent on the tab wiring. Print the page errors
  before theorising about a control: `page.on('pageerror', …)` names it in one
  run.
- **`check:templates` reports every parse error with its backtick advice.** A
  duplicate `const` sent somebody hunting for a backtick that was not there,
  while the error line above said, correctly, "Identifier already declared". A
  failure message that names the wrong cause is worse than a bare count,
  because it points somewhere and somewhere is wrong. Fixed in the check; read
  the line above the advice.
- **A harness that names itself correctly can still be invisible to the rule,
  because the CHANNEL PREFIX goes in front.** `jobs.is_fixture` has a `gate-%`
  branch; `scripts/poc/gate-3.ts` posts a Telegram webhook as user 4242, and
  `enqueue_inbound` composes `requested_by` as `<origin_channel>:<actor>` — so
  the value is `telegram:4242` and the branch never fires. Twenty-seven jobs
  accumulated, and the moment #198's channel states and #202's undelivered list
  went live they read them as real and reported **Telegram DEGRADED, twenty-one
  undelivered messages** to Grant. Harness traffic presented as the office
  failing, inside the two features built to make the office legible — which is
  the worst place for it, because a health reading that cries wolf teaches him
  to ignore health readings. A Telegram id must be numeric, so the payload
  cannot carry a fixture-shaped name: the harness corrects its own jobs in
  teardown instead (0351). Same defect as `verify:addressing`'s 43 real jobs,
  which 0342 was written for and which nobody carried across to gate-3.
- **`coalesce(x.flag, false) = false` over a LEFT JOIN treats "I know nothing
  about this" as "this is real".** Both readers counted a delivery with NO job
  as a genuine failure — no project, no requester, nothing to retry into, and
  eight of them had `error_code` ending `(injected)`, a fault-injection test
  saying so in the data. 0304's asymmetry lesson in a different costume: the
  absence of a fixture flag is not the presence of a real one. An INNER join is
  the fix, and the question to ask is whether the reader can name who is
  responsible for the row before it reports it.
- **A suite's constant output must be marked `deterministic`, or the job it
  belongs to can never be committed AND can never be cleared.** `verify:history`
  inserted `An answer <run>` with `deterministic = false`, so §10's commit gate
  refused — correctly: an unreviewed output must not be committed. The job then
  sat in `committing` for ever, because `committing -> cancelled` is not a legal
  transition and the teardown's `state not in (complete, cancelled, failed)`
  guard reads like a complete guard and is not. Two of them stranded **every
  `npm run deploy:worker` for a day**, reported as "illegal job transition
  committing -> notifying" — four steps from the line that caused it. A
  constant a suite writes IS deterministic; saying otherwise claims a judgement
  nobody made. And a teardown must know which move each state actually allows:
  `committing`, `committed` and `notifying` can only go to `failed`.
- **A scope that covers most of a file is not a scope.** #184 gave
  `verify:worker` a dequeue scope and ten of its thirteen `dequeue` calls took
  it; three did not, and those three are reached only when the office HAPPENS
  to have work queued. It did: the concurrency pair claimed a real
  `drive.watch` job, `runJob` threw `NoHandlerError` because the suite holds no
  handler for it, and the suite died four sections early with a duty's work
  leased to a fixture worker until the lease expired. Two more of my own runs
  then took the same job again. The awkward one is the CONTROL that
  DELIBERATELY dequeues unscoped to prove the filter is what refused the job —
  it cannot take the scope, so give it a probe KIND nothing else enqueues
  instead. Grep for every call, not the ones the fix was written for.
- **A whitelist of permitted values fails by refusing to speak, which is the
  expensive direction.** #185's citation check began as a list of source
  schemes and refused `db:projects` — a perfectly good address nobody had
  thought to write down. Every handler writes `<scheme>:<ref>`, so the SHAPE
  was checkable without a list, and a shape cannot go stale when the office
  grows a source it did not have. Prefer a property over an enumeration
  wherever the enumeration is of things a future change will add to; it is the
  same correction as asserting an index by name, five entries up.
- **A verification that goes red on debris its own crashed runs left behind
  looks exactly like a live defect.** `verify:worker`'s duty-backlog check
  reported six `drive.watch` jobs queued past their ten-minute period, which
  reads as the office falling behind. Five of the six were jobs my own crashed
  suite runs had stranded. The queue drained to zero the moment the worker was
  deployed and the check went green. **Before filing "the office is broken",
  clear your own debris and re-run** — that is now the third time harness
  traffic has been about to be reported to Grant as a failure.
- **HTML collapses whitespace, so a body rendered in one tag loses every
  newline in it.** `<p>${esc(m.text)}</p>` in the studio's bubble renderer is
  why #186's whole outcome — two or three short paragraphs, one thought each —
  **had never once been visible on the dashboard**, while Telegram and Slack
  showed it correctly the entire time. `verify:chat`, `verify:layouts` and
  `verify:access` were all green over it, because one long paragraph is not
  overflow, not low contrast, not small type and not a dead control. It
  surfaced only when Grant asked for numbered lists and one arrived as
  `1. first 2. second 3. third` on a single line. Before assuming a body
  renders as written, check what the surface does with `\n`.
- **A check that compares a measurement to a THRESHOLD can be green on one
  device leg for the right reason and green on the other for the wrong one.**
  #209 took three attempts and the first two failed identically: rendered
  HEIGHT (a run-together body wraps to thirteen lines on a 390px phone and
  clears a six-line bar) and then whether item 2 began at the paragraph's left
  edge (the phone wrap put it there anyway, +0px, with the defect live). Both
  went red on desktop and green on phone. **That is worse than no check** — the
  suite reports a failure, you fix what it names, and you never learn half of
  it was inert. What discriminates is structure compared AGAINST ITSELF: three
  blocks, three list items, each box below the previous. Run the control on
  every device leg, not just the one that failed.
- **Line breaks are not a list.** #209's first fix put each numbered item on
  its own line and the desktop capture looked finished. The phone capture
  refuted it: at 390px the continuation of item 1 wrapped into the column item
  2 began in, so three items read as five at the width Grant actually uses. A
  real ordered list gets the hanging indent for nothing, and a screen reader
  gets "list, 3 items" with it. **Capture the phone before believing a list
  renders**, and prefer the element the language already has over the one you
  can assemble from breaks.
- **A sweep that presses every control will press the one that hides the
  others — third instance, and this time it was the sheet's own Close
  button.** `shutDock` (#103) and `openRail` (#183) exist for the dock and the
  rail; the settings sheet had no equivalent. Close sits in `.chead`, so the
  collector gathers it FIRST, and every control gathered after it on that route
  still resolves — the nodes stay in the tree — with **no box**. Playwright
  then says `element is not visible`, which reads like a product defect. Five
  of the six tabs had nothing left to press after Close because those controls
  were already de-duplicated from an earlier route; the Behaviour tab had three
  that were not, and they became #111 — including the switch Grant relies on
  for `telegram.only_chief_speaks`. **All three work.** Settings went from 12
  pressed / 93 unpressable, to 12 / 3 after #190, to **92 / 0**.
- **`body.behind` is the signal for "a sheet is open", never the presence of
  `.sheet`.** The studio leaves the sheet element in the tree and takes its box
  away, so querying for the node reports it open while it is shut — which is
  exactly what made the three toggles look broken. A first draft of the repair
  logged `[open]` before every failing press, because it asked the wrong
  question.
- **Scoping the collector is half the rule; the LOCATOR has to be scoped
  too.** #190 stopped the sweep gathering the ninety controls behind an open
  sheet, and left the locator that presses them searching the whole document by
  label text. With Settings open, "Team" is both the settings tab and the
  rail's *Call the team* button behind the sheet — `hasText` matched both, the
  deepest-match rule picked the unreachable one, and six routes each reported a
  control that works. Scope the thing that FINDS a control as well as the thing
  that lists it.
- **A repair that runs before the CLICK can still run after the state has been
  read.** The sheet restore was first called inside `press()`, which is one
  step too late: by then the front-most-surface selector had already been
  computed against a shut sheet and come back empty, so the locator was
  unscoped again. #183's `openRail` was one step too EARLY for the mirror-image
  reason. Restore shell state before anything reads the page, not merely before
  the press.
- **A report line that states an impossibility teaches the reader to skim the
  whole report.** The control audit printed *"did nothing: 6 (12 of those are
  known-inert prototype stubs)"* — it was printing the ALLOW-LIST's size, not
  how many of that run's inert controls matched it. Twelve of six is not a
  number. Same cost as `check:templates` naming the wrong cause for every parse
  error.
- **Measure a touch target with touch emulation on.** The Behaviour toggles
  measure 50x29 in a bare 390px viewport and **58x52** in a real
  `hasTouch`/`isMobile` context, because the phone rules add the padding. The
  first reading was one sentence away from being reported to Grant as a
  fourth false finding. `verify:ui` already walks all seven settings panes and
  enforces the floor properly.
- **A verify suite that calls a real function OUTSIDE a transaction is one
  behaviour change away from being destructive.** `verify:disconnect` wrapped
  every assertion in `begin … rollback` EXCEPT a loop over six services that
  were all refusals — nothing to roll back, so why pay for one. 0350 turned
  Slack and Telegram into real disconnects, and from that afternoon **every run
  of the suite deleted Slack's bot token and signing secret.** It did not read
  as destructive: the check simply went red, saying "slack is refused" about a
  service that had just been disconnected for real. Wrap the call, not the
  assertion — the wrapper cannot know which kind it is until it has already
  happened.
- **A deleted secret does not merely disable its feature; a DANGLING REFERENCE
  stops everything.** `slack_app_credentials` points at the vault by uuid and
  `app.resolve_secret` raises `23503` on a ref that resolves to nothing, so a
  missing Slack token took down every job in the building — `deploy:worker`
  returned http 500 and no duty ran. A trigger then refuses to UPDATE the row
  while ANY of its five refs dangle, so the repair has to null all of them in
  one statement, not just the one you noticed. Nulling is what the callers
  already handle: `resolve_secret(null)` returns null and Slack degrades alone.
- **A delete keyed on a name nobody checked deletes nothing and reports
  success.** 0350's Telegram branch removes `telegram.bot_token` and
  `telegram.chief_bot_token`; the stored names are `telegram.chief.bot_token`
  and seven staff bots. **That branch has never matched a row**, and it returns
  `ok: true` with a note about what reconnecting will cost. It is the only
  reason Telegram survived the defect above — luck, not design. Assert that a
  destructive function actually removed something, by counting before and
  after, or it is a claim with nothing behind it (#210).
- **A comment claiming a property is worth nothing without a check — third
  instance, and this one was about a credential.** `revokeAtGoogle`'s first
  draft said "never rethrown with the token in it" and then interpolated
  `error.message` straight into the outcome. `fetch` puts the request in that
  message, so a network failure carried the whole Google refresh token into
  `connection_health.detail`, which the studio renders. A unit test found it in
  one run. Remove a credential you are HOLDING by value — exact, no pattern to
  get wrong — and run `redactSecrets` after it for what you cannot enumerate.
- **A by-value redaction needs a length floor.** The fix above stripped the
  token with `split`/`join`, and a one-character token in a test turned that
  into a find-and-replace on a single letter: "Google refused:
  h[redacted][redacted]p 400 invalid_reques[redacted]". Nothing leaked and the
  sentence was destroyed, which on a real failure is all Grant would have.
- **A job in a FIXTURE PROJECT is harness traffic, and the generated column
  cannot see it — third instance.** 0342 taught `jobs.is_fixture` about
  `%:verify-%`; 0351 corrected `telegram:4242`. Both fixed the ROWS that
  existed at that moment and neither covered the shape underneath: **85 jobs
  whose project is a fixture and whose own flag says real**, oldest 7
  September, newest the morning it was found. `app.undelivered()` was showing
  Grant two of them as genuine failed deliveries, under a project literally
  named `fixture-conversation-…`. `is_fixture` is GENERATED so it may only
  reference its own row, and a trigger-maintained copy is what 0303/0304 exist
  to warn against — so 0355 DERIVES it once in `app.harness_job` and the three
  readers that report to him ask that. **Assert the property, never the count:
  "no row the reader shows Grant belongs to a fixture project" survives the
  next harness run; a number does not, which is precisely how this came back.**
- **A gate that refuses without recording is a lost answer, not a saved one.**
  #185's SENDING gate writes an impediment when it refuses; the CREATION gate
  in `runJob` was a bare `moveTo(failed)`. Three jobs in 48 hours went that way
  — two of them Grant asking from the dashboard — so he typed a question, the
  model claimed a read it had not done, the gate correctly stopped the lie, and
  he received **nothing**: no answer, no explanation, no row on the Governance
  page, just `failed` in a table he does not read. The better gate was the
  silent one. If a guard can swallow a user's request, it has to say so
  somewhere the user looks (#211).
- **A second independent query written to the same definition must be updated
  with it.** `verify:transport` deliberately restates "which failures are real"
  rather than calling the reader, so a disagreement means one side is wrong.
  0355 changed the definition and the check went red at "1 shown, 3 exist" —
  the check working exactly as its own comment promised. Read that failure as
  the counterpart being stale, not the reader being broken, and change both.
- **`pg_get_functiondef` emits no trailing semicolon — twice now.** 0353 hit it
  and 0355 hit it again, generating three definitions and joining them with a
  blank line: `syntax error at or near "CREATE"` on the SECOND function, which
  points at the line after the real problem. When a migration is built FROM
  live definitions (the safe way to change one predicate in an 8,000-character
  function without transcribing it), terminate every one.
- **`order by <timestamp> desc, <uuid> desc` is a coin flip, and it decided
  which project a chat was pointed at.** `app.current_project` broke ties with
  `gen_random_uuid()` while `switched_at` defaults to `app.now_utc()`, which is
  `now()` — the TRANSACTION timestamp, identical to the microsecond for two rows
  written in one statement. So "the latest switch wins" was true on average.
  `verify:agents` reported **56/56 on 11 September and 55/56 on 14 September
  against identical code**, and both runs were honest. 0291 had fixed the order
  of the FILTER and left the order of the ROWS undecided. A monotonic identity
  column is the tiebreaker (0361) — assigned by the sequence at INSERT, so it
  reflects write order where the clock cannot. **Before ordering by a uuid,
  ask what it is standing in for.** `min(uuid)` is already in this list; this is
  the same mistake wearing an ORDER BY.
- **A suite that has been run ONCE is barely more evidence than one that has
  never been run.** The flake above was invisible for at least three days and
  was found only because the same suite happened to run twice against the same
  code and somebody happened to compare. `e2e.ts` keys one result per suite and
  the next run overwrites it, so a suite failing one run in three looks like a
  suite that failed, got fixed, and passes. Keyed to the COMMIT, two different
  verdicts is the signal; across a change it is just a change (#226).
- **Validate the test before you change production code.** The regression check
  written for 0361 failed **10 of 10** on its first run and looked exactly like
  a live ordering defect. It had reused a subject an earlier section of the same
  file had already retired — the file warns about this forty lines above — and a
  retired project is a fixture, a fixture switch correctly reads as no scope,
  and every null counted as the older switch winning. The test was wrong and the
  fix was right, which is the one direction that sends somebody rewriting a
  function that works.
- **A security check that cries wolf is one somebody starts overriding.**
  `verify:hq`'s token-shape list had a bare `/xox[abposr]-/`, and it matched the
  Slack credential field's own `placeholder="xoxb-…"` and the help text *"Starts
  xoxb-"*. Nothing had leaked. Four of the six shapes already required token
  MATERIAL after the prefix and two did not. Assert the property — a credential
  is present — not the artefact, which was "the letters xoxb appear somewhere";
  fourth instance of that correction in this file. **And loosening a security
  pattern needs a control**: each shape is now shown a synthetic credential of
  its own kind and must still catch it, because a shape list can be weakened
  until it matches nothing and every check goes on reading "clean". Build the
  specimens from concatenated pieces so no token-shaped literal sits in the
  repository.
- **32 foreign keys point at `public.projects` and only nine cascade.**
  `app.project_delete` cleared attachments and the switch log and not
  `slack_channel_map`, so a project that had ever had a Slack channel could
  never be deleted — and it failed by RAISING `23503` out of a SECURITY DEFINER
  function rather than refusing, which killed `check:leaks --sweep` five
  projects into eleven and abandoned the other six. Two defects in one crash,
  and fixing only the named table would bring the second one back. 0360 clears
  the mapping AND turns any remaining violation into a sentence naming what
  holds the project. A sweep must also continue past one failure and say how
  many it could not remove: **a sweep that stops early looks exactly like a
  sweep that finished.**
- **A global dispatcher has no scope argument and should not get one.**
  `app.dispatch_due_responsibilities()` fires EVERY due duty — the office runs it
  on a tick and it is meant to be global — so a suite that calls it also fires
  Grant's real duties. Adding a scope parameter for the test's convenience would
  mean testing a path nobody runs. The answer is that every call sits inside one
  statement ending in `rollback`: real duties that were due are fired and
  un-fired and stay due, and the next real tick takes them. Same shape as #184's
  unscoped dequeue, and #210's rule decides the mechanics — **wrap the CALL, not
  the assertion**, because a wrapper cannot know a call was destructive until it
  already has been.
- **`dequeue_job` only takes `state = 'queued'`, so an expired lease is not
  reclaimed by dequeuing again.** `app.recover_stalled_jobs()` is what decides an
  abandoned job is abandoned, and it moves the job to **`retrying`**, not
  `queued` — deliberately, because recovery does not pretend the lost attempt
  never happened, so `attempts` still counts and a job that strands repeatedly
  runs out of attempts instead of looping for ever. A check written against
  `dequeue` returned nothing and read exactly like a stranded job; a check
  written against `queued` demanded the office forget the dead attempt. Both were
  the wrong layer, which CLAUDE.md already warns about, twice.
- **A report line must print the message it actually got, never one you decided
  in advance.** A duplicate-migration check displayed `23505 duplicate key`
  whenever anything threw, while testing for that string separately — so it went
  red while showing the exact words it had failed to find. The real error was
  `23502 null value in column "checksum"`: a refusal for the wrong reason, which
  the assertion correctly rejected and the outcome line hid. Same defect as the
  audit that printed "12 of 6".
- **A grading rubric can be structurally wrong for this office, and a small
  corpus hides it.** The evaluator's judge asked one question — *"did it do what
  was asked?"* — which rewards confident completion and penalises honest refusal.
  On seven historical cases it agreed with Grant 7/7. Expanding the corpus to
  twenty, with a `good` control beside every `poor` case, dropped agreement to
  15/20 and every disagreement had the same shape: it graded a fabricated
  database read as GOOD ("provided the requested count"), nominal delegation as
  GOOD ("asked Emma and reported her findings"), and marked as POOR an answer
  that admitted it had not looked, one that asked which of two projects was
  meant, and one that explicitly parked a clause. **The judge was measuring
  compliance while the office's first invariant is not claiming what it did not
  do.** A corpus of failures alone cannot show this — only the paired controls
  can, because a judge that marks everything poor scores perfectly on a corpus of
  poor answers.
- **`eval_cases.context` exists so the grader can know what the text cannot
  show**, and a rubric that never mentions the context makes the column dead
  weight. "No tool call was made" is only evidence if the rubric says a claimed
  read without one is the worst thing in the list.
- **`temperature: 0` does not make a free model deterministic, and the judge
  proves it.** `eval.ts` already pinned the judge MODEL because three mixtures
  gave three answers, then left the SAMPLING free. Pinning it as well was the
  obvious next step and it is not sufficient: two consecutive runs of an
  unchanged corpus, same pinned model, temperature 0, gave 16/19 and 16/18 —
  one verdict flipped outright, two cases moved two points, and a DIFFERENT case
  failed to parse each time. Ask for temperature 0 anyway, it costs nothing, and
  then **print the margin next to the number** so nobody tunes a prompt against
  a coin. A systematic five-case bias still shows through a two-case margin,
  which is the useful thing to know about it (#229).
- **Some of that noise is not sampling — it is the reasoning budget.** A judge
  given `maxTokens: 2000` spends it thinking and returns no content, which lands
  as "the judge's answer could not be read" and quietly changes the denominator.
  #116 already recorded a worst case of 1,091 reasoning tokens before any
  content. Raise the budget before blaming the model.
- **Renaming a project makes it permanently undeletable.**
  `app.hq_rename_project` enqueues an `office.rename_channels` job — correctly,
  because renaming the Slack channel is an API call and this is SQL — and a job
  can never be deleted, so `project_delete` refuses the project for ever. A
  suite that renames a REAL project therefore leaves permanent debris, and the
  first draft of #224's project arc left three archived projects on its first
  run: CLAUDE.md's own twenty-five-project pile, rebuilt by the suite written to
  close a coverage gap. A fixture project is not the escape either, because
  `resolve_project_by_name` filters `not is_fixture` and the name assertions
  would pass for the wrong reason. The arc runs inside a rollback instead, and
  asserts that the discarded rename job left nothing behind.
- **A pre-check that only ever existed on one of two writers.**
  `hq_create_project` refused a name a live project already held;
  `hq_rename_project` did not check at all, so two active projects could answer
  to one name and Grant would be routed to whichever the resolver ranked first
  (0365). CLAUDE.md already records 0282/0293 — a constraint loosened while its
  pre-check stayed strict — and this is the third instance with nothing
  loosened: the check was simply never written on the second door. **When two
  functions write the same field, grep for the other one.**
- **Asserting an ERROR where the office asks a QUESTION goes red on correct
  behaviour.** The duplicate-create check was written expecting a refusal.
  `hq_create_project` returns `needs_confirmation` with the candidates it
  matched — *"There is already something by that name. Did you mean one of
  these…"* — which is Grant's *"should always be confirmed"* implemented rather
  than merely obeyed. A check asserting `error` would have invited somebody to
  fix the asking away. Assert that nothing was created and that the question
  names what it matched; never the mechanism, never the wording.
- **`connector_capabilities` is keyed to KNOWLEDGE CONNECTORS, and there are
  only six of them.** A dashboard project is attached to a `drive`, a `notion`,
  a `notebooklm`, a `github`, an `mcp` or an `upload` — that is what the table
  is for, and a foreign key enforces it. Gmail and Calendar are not project
  sources and have no rows there, which looks alarming and is correct. What
  agents are actually told comes from **`tool_permissions`**, read by
  `capabilityBrief`: `gmail.read`, `gmail.search`, `calendar.read` and
  `calendar.write` are on, and `gmail.send` is deliberately off while the
  `gmail.compose` scope is granted — the scope makes sending possible and the
  switch is what stops it. A migration adding Gmail to the wrong table was
  written and refused by that foreign key before it could confuse anybody.
- **A check can pass because it asked a question the schema cannot answer.**
  `verify:google-live`'s first capability check queried
  `connector_capabilities` for connectors named `gmail`, `google_drive` and
  `google_calendar`. None exists, so it matched nothing and reported
  *"0 claim(s) marked api"* — green, and vacuous. Worse than a missing check,
  because the report says the question was asked. **When a check's happy path is
  "found nothing", assert first that the thing it searches is non-empty.**
- **A ceiling that predates half the roster silently overrules every subject
  match under it.** `ROSTER_CEILINGS.direct_command` was research, strategy and
  operations, so *"Draft the announcement email for the pricing change"* named
  the communications director, was refused by the table and fell to
  `ceiling[0]` — six of eleven communications cases in the #232 corpus went to
  the RESEARCH director, which is worse than going to Claire because the wrong
  specialist answers confidently. Third instance of #230's shape. When you add
  somebody to a roster, grep for every list that gates who may be convened, not
  just the one the feature was written for.
- **A fallback class and a real class sharing one name makes both
  unreachable.** `classifyIntent` returns `thought` for a deliberate remark
  ("fyi", "note to self") AND for anything its regexes did not understand.
  `thought`'s ceiling is empty, correctly, for the first — so every indirect,
  vague or spoken phrasing scored 0% because the right specialist was named and
  then discarded before the subject was ever consulted. `Classification.recognised`
  separates them. The general rule: when a default value is also a legitimate
  value, nothing downstream can tell "we decided this" from "we did not know",
  and 0304's asymmetry lesson applies — say which one it was.
- **An uncertain READING is not an uncertain SUBJECT.** `pickRoster`'s
  unconfident branch answered "which one specialist" twice and badly: nobody at
  all for a question, even when the subject was unmistakable, and `ceiling[0]`
  for every other class, ignoring the subject entirely. §6 correctly caps a
  contested reading at one person; it says nothing about WHICH one, and the
  subject is right there.
- **A test corpus needs its own controls checked before its findings are
  believed.** #232's first run reported a false positive on *"What time did the
  backup finish?"* — a control that names a real operations noun, so routing it
  to the operations director is the vocabulary WORKING. Kept, still reported,
  marked `defensible` and excluded from the assertion: a guard that fires on
  correct behaviour teaches you to ignore the guard. And its agreement check
  reported a disagreement (offline=[] live=[chief-of-staff]) that was entirely
  the harness not speaking the product's vocabulary — `roster[0] ?? 'chief-of-staff'`
  means an empty roster IS Claire.
- **A live-agreement sample made only of cases the OLD code also gets right
  proves nothing about the deployed thing.** #232's first sample was two
  fallback cases, which would have agreed against a worker built before any of
  the work existed. The sample now includes a case no word in which names
  anybody, so it can only route correctly through the new path — and it is
  chosen from the run's own results, so improving the routing cannot quietly
  turn it back into a fallback case.
- **A parameter no caller passes is a column that will never hold anything.**
  `recordDecision(db, jobId, decision, delegationDepth = 0)` — the fourth
  argument had existed since `routing_decisions` did and NOT ONE caller passed
  it, so `delegation_depth` was 0 on every row by construction and "is the
  office delegating" was a question the column could not answer whatever the
  office did. Same family as a column nothing reads and a control nothing
  presses. Grep for the callers of a defaulted parameter before believing what
  its column says.
- **`record_consultation`'s fifth argument is `p_requests`, not depth.** Read
  the definition (`npm run qq`) rather than inferring an argument from the
  shape of the call you want to make. Also: `public.preferences` does not exist
  (it is `system_config`, and a CHANGED preference is `preference_instructions`)
  and `deliveries` has `sent_at`, not `delivered_at`. Three guessed names in
  one afternoon, all refused, all avoidable by one `information_schema` query.
- **A live-agreement check whose sample the OLD code also gets right proves
  nothing about what is deployed.** #232's first sample was two cases the
  literal matcher already handled, so it would have agreed against a worker
  built before the feature existed. Include a case that can ONLY pass through
  the new path, and pick it from the run's own results so improving the code
  cannot quietly turn it back into a fallback case.
- **A test whose subject the product deliberately refuses is asserting against
  a safety rule.** `verify:collaborates` first used a phrasing `classifyIntent`
  does not recognise, so the roster was capped at one — correctly, and not as a
  preference: `routing_decisions_unconfident_stays_small` refuses a wider
  roster on an unconfident row. The suite went red while the office behaved
  exactly as designed. Validate the SUBJECT of a test against the rules before
  reading its result as a defect.
- **Wait for the thing you are asserting about, not for its parent.** The same
  suite broke its wait loop when the parent job was terminal and then asserted
  on the CHILD's routing decision, which that child writes near the end of its
  own run. It reported "no routing decision was recorded" about a job that was
  still running — indistinguishable from the column never being written.
- **The Supabase Management API throttles, and a 429 is not an answer.** Six
  concurrent `who_knows_about` lookups earned `ThrottlerException`, and a
  throttle falling through as "nobody knows about this" turns a correct routing
  decision into a miss and moves a headline accuracy figure for reasons that
  have nothing to do with the office. Retry with backoff; never let an infra
  failure enter a measurement as data.
- **A check that has only ever reported zero is indistinguishable from a check
  that cannot report anything.** `levels`'s registration lookup reported "0
  registry rows naming an unimplemented kind", which was correct — and it had
  reported TEN a minute earlier because a missing import sent every lookup into
  the catch. The zero and the ten were produced by the same code. Give any
  found-nothing check a control that must come back positive.
- **A dimension list in TypeScript is one Grant cannot add to.** 0366 put the
  #235 coverage dimensions in `public.breadth_dimensions` with a trigger
  validating tags against it, rather than a CHECK enumerating thirty-seven
  words — which is what 0311 spent a migration undoing. The trigger matters for
  a second reason: a misspelled dimension does not error, it silently creates a
  zero in the matrix and hides the case from the count, which is the one
  failure a coverage model cannot survive.
- **A registry row that says a capability EXISTS but not what it NEEDS gets
  the gap filled in by the model.** `tool_permissions.description` for
  `task.create` was four words, so an agent invented an intake form — *"1.
  Title 2. Due date 3. Owner 4. Parent task"* — of which three are optional and
  **a parent task is not a parameter at all**. Invented twice, in two sessions,
  because nothing said otherwise. 0298 made a capability claim CHECKABLE;
  0368 makes the real ones describe their own shape. Write the sentence as
  data, in the table Grant edits, not in the prompt builder.
- **The office has no outbound path while it is answering, so "I've posted a
  Slack message to the team" is false by construction.** It said exactly that,
  and `deliveries` for the job was zero — Grant would have waited for replies
  from people who were never asked. Worse than a fabricated read, which
  produces a wrong answer he can argue with. `claimsToHaveSent` can be strict
  where `claimsToHaveRead` must be narrow, precisely because there is nothing
  it could ever be true of; future tense is left alone, because a plan is not
  a claim.
- **A gate that fails into silence gets quieter the better it gets.** The
  coherence gate refused two of four turns in an ordinary conversation and
  Grant received nothing at all. Widening its detector would have made the
  office quieter still — so the retry landed first: the refusal goes into
  `pinned_config` and the next attempt puts it in the prompt, which is a closed
  loop rather than a coin flip. Ship the recovery before the stricter check.
- **"Do not draft the plan. Create the tasks instead." is a command, and the
  `^` anchor could not see it.** `make-this` was anchored at the start of the
  MESSAGE, so the whole "not that, this instead" shape — which is how Grant
  changes his mind — fell to an unconfident `thought`: nobody convened, nothing
  written. A lookbehind for a sentence terminator keeps everything the anchor
  bought, because the sentence it excluded ("I do not want you to create a
  task") has its verb mid-clause.
- **A trigram subject matcher routes "the onboarding NOT the pricing" to the
  pricing person.** Worse than a miss: a miss lands on the Chief of Staff and
  this lands on somebody confidently answering the question that was withdrawn.
  It also hides the semantic layer, which only runs when the literal matcher
  finds nobody. `withoutNegated` strips excluded subjects from the LOOKUP text
  only — the model still reads every word — and the one way it could make
  things worse is closed by name: a negated VERB ("I do not think the pricing
  matters") is not a negated subject.
- **An eight-clause work request was filed as a global procedure called
  "Shoulding decide".** `WHEN_YOU` matched "suggest WHEN we should decide," —
  a complement clause, not a condition — and nothing distinguished a request
  for WORK from a teaching once the text was long enough. The request went
  unanswered AND the office's memory gained something it would put in front of
  unrelated work for ever. Anchor a condition at a clause start, and ask
  whether the sentence is somebody asking for work before reading it as
  somebody teaching.
- **A harness expectation is a claim about the product and is wrong about half
  the time at first.** Tonight: a correction asserted as the literal "40" when
  the right answer said 34 (0.85 x 40, the correction APPLIED); a task count
  where the office legitimately asks for a title first, three times; a
  contradiction corpus that never reached a contradiction because every case
  was missing its material, so the office honestly said so and passed; and a
  turn whose job FAILED scoring green because `recipient_agent` is written
  before the failure. **Read the answer before believing the assertion.**
- **A resumable harness needs a new CHAT on reset and the SAME projects.**
  `app.conversation_before` threads on the chat, so replaying a session into
  the old one opens turn 0 with the previous run's turns behind it and every
  referent test answers a question nobody asked. The PROJECT has no such
  requirement, and giving it a generation too produced 41 fixture projects in
  one night — every one of which gathered a job and can therefore never be
  deleted.
- **`verify:controls` now takes more than ten minutes.** #183's fix took it
  from 91 pressed to 289, so the run legitimately exceeds the shell's ceiling.
  The npm script already splits itself desktop-then-phone; give the call a real
  timeout and let it print rather than backgrounding it.
- **A non-raw Python heredoc turns `\b` in a regex into U+0008, and nothing
  anywhere shows it.** Writing a pattern into a file with `python3 - <<'PY'`
  and a plain `'''…'''` string converts every `\b` to a backspace character.
  `String.raw` then preserves it, so the regex asks for a backspace where a
  word boundary was meant and matches nothing, for ever. The editor renders
  nothing, `sed` prints nothing, `git diff` prints nothing, biome and tsc are
  both happy — and `JSON.stringify(re.source)` prints the character back as the
  two characters `\b`, so the one piece of debugging output anybody reaches for
  CONFIRMS the pattern is correct. Eight of them in one function, and four
  hypotheses (including a wrongly-suspected module cache) before the truth.
  `npm run check:templates` now refuses any control character repo-wide. Use
  `r'''…'''` or double every backslash.
- **`String.replace(old, new)` on a string replaces EVERY occurrence, and a
  code block you think is unique usually is not.** An absence exemption meant
  for `claimsToHaveRead` landed in `claimsToHaveSent` and `promisesToReachOut`
  as well, because all three end with the identical six-line
  `for (const re of claims)` loop. Pass a count, or match something that
  includes the function's own name. The companion trap: a multi-edit script
  whose LAST assertion fails writes NOTHING, while the earlier edits look
  applied because you read the diff you intended.
- **A literal-string assertion is a wording lock — sixth instance, and this one
  cost the only run a held-out corpus gets.** Six hallucination baits, six
  honest answers, and the assertion listed six ways of saying "I cannot see
  it": it scored 3/6 while nothing had been invented. "There is no entry", "I
  do not see anything logged there" and "there is nothing on that" were the
  three it was missing, and a list will always be missing a fourth. Assert the
  shape — does it state an absence or ask, and is it SHORT — because an
  invented summary of a document that does not exist is long.
- **Every coherence gate keys on a CLAIM, so a bare assertion is invisible to
  all of them.** `claimsToHaveRead` needs "I checked", `claimsToHaveSent` needs
  "I posted", `claimsGrantSaid` needs "you told me". Asked about a meeting that
  never happened, the office answered with two calendar entries, clock times, a
  due date and named agenda items — claiming nothing, and passing every gate.
  It had also absorbed three earlier baits in the same chat and served them
  back as fact: its own honest *"I have nothing on Priya"* had become evidence
  that Priya exists. What is checkable without a model is not truth but
  DERIVABILITY: £26 follows from £40 and £14, and 3.19 PM follows from nothing.
  `fabricatedWhen` compares times and dates against the instruction, the
  conversation and the retrieved documents, and the handler supplies that
  grounding because it is the only thing that knows what it showed the model.
- **And then it read the price £63.50 as sixty-three minutes past something.**
  The first draft was `\d{1,2}[:.]\d{2}` with an optional am/pm. It refused a
  good answer four times, which is worse than no gate: a check that fires
  wrongly is one somebody switches off. The colon form is now bounded to a real
  clock and the DOT form requires am or pm, because money is far commoner here
  than a dotted time. Missing a bare "9.30" is the cheap direction — a missed
  invention is one bad answer, a false refusal is every good answer that
  mentions a price.
- **An absence is still a claim when it is about somewhere nothing looked.**
  The honest answer to a bait — *"I checked our notebook and the project
  documents and there is no entry"* — was refused every time, because the
  sentence claims a look and `evidence` on an answer that found nothing can
  only be `inferred`: there is no value in the vocabulary for "searched,
  empty", so the office was structurally unable to say the true thing. But the
  exemption cannot be general, and two existing #237 tests are why: *"I checked
  GitHub and the mail folder, but I have nothing"* tells Grant not to search
  them himself, and this path queries `public.documents` and nothing else. Draw
  the line from what `retrieve()` actually does, not from judgement.
- **"Prefer them" about documents outranked Grant's own sentence.** He wrote
  five facts into one message — forty pounds a month, three tiers, email-only
  support, two weeks to onboard, twelve-month contract — and got back £63.50
  from an unrelated document, "dedicated 24/7 support" and "month-to-month up
  to annual commitments". The prompt line meant *prefer documents over what you
  merely know* and reads as *prefer them over everything*. Worse than an
  invention, because the answer is about his own business and wrong in the
  details he had just supplied. State the precedence in full: documents beat
  general knowledge, and what he says beats both.
- **A contentless rejection resolved against the thread becomes the thing being
  rejected.** *"That is not what I meant at all."* produced *"Routed to Ruby.
  You asked for Ruby's input on the margin impact."* — the previous turn
  happening again, at the moment he said it was wrong. `resolveAgainstThread`
  is doing its job: a message with no content of its own resolves into the last
  instruction, and the last instruction is what he is rejecting. So the better
  the resolver gets, the more confidently it rebuilds the misunderstanding.
  Answer it in code, BEFORE the resolver, because afterwards the fragment is
  gone. And define "carries nothing" by stripping the rejection and counting
  what is left, not by enumerating the shapes a replacement can take — the
  enumeration was wrong in both directions on its first run.
- **A delegation governs its own span.** *"I need you to find out what they
  charge and then tell me what that means"* fired three intent rules: the
  assignment, plus `light_investigation` for "find out" and `question` for
  "tell me". Three classes means contested, and
  `routing_decisions_unconfident_stays_small` then caps the roster at ONE — so
  a request plainly needing two specialists reached one, and the reason
  recorded said the reading was contested. It was not: those words are the
  CONTENT of the delegation. The mood of a sentence is set by its main clause.
  `teaching.ts` already had this lesson about complement clauses; only anything
  at or above `assignment` survives the span, so urgency is untouched.
- **A clause is what has a subject, not a message.** `who_knows_about` is a
  trigram match over whatever it is given, so a whole-message match has exactly
  one winner — *"look at which channel is bringing people in and draft the note
  we send them"* came back as communications alone, because "channel" is in the
  growth director's expertise and lost to a sentence mostly about writing. And
  it silenced the layer built for this: the semantic reader runs only when the
  literal matcher finds NOBODY, which is right, and was being asked of the
  message. One answered clause meant no clause was read for meaning. #237's
  lesson in its partial form.
- **The ceiling is a gate and was being used as a preference.** `pickRoster`
  wrote `ceiling.filter(r => fromRoster.includes(r))`, so the intersection came
  out in the order of a hardcoded list and `roster[0]` — who ANSWERS — was
  whoever appeared first in it. *"Draft the announcement copy"* is ranked
  communications, growth by Grant's own expertise columns and went to growth;
  *"audit the refund policy for compliance risk"* ranked quality first and went
  to research. #230 and #232 each fixed a version of "the ceiling's first entry
  decided"; this was the ordinary case, and the unconfident branch had been
  reading subject-first all along.
- **`roster[0] ?? 'chief-of-staff'` is the right fallback and the wrong thing
  to store.** #233 recorded `[who.slug, ...alsoConvened]` into
  `routing_decisions.roster`, so a question that convened NOBODY was stored as
  having convened Claire — in the column `npm run measure` counts from. 0311's
  lesson in a column: two ways to say one thing and no reader can tell them
  apart. Store what `pickRoster` returned, which may legitimately be empty.
- **A job that runs out of attempts owes Grant a sentence, and three separate
  gates had to learn it.** The coherence gate records an impediment (#211); the
  output INSERT refusal did not, and swallowed a preference Grant had taught
  the office; and a handler that threw until its attempts ran out recorded
  nothing at all. Found when OpenRouter's daily free quota ran out and eighteen
  jobs failed in thirty minutes with nothing anywhere saying the office could
  not think. Anything that can end a turn with no answer has to say so
  somewhere he looks.
- **`create or replace` on a confirmation's `path` is four sites, not one.**
  Every code-composed confirmation in `handlers/instruction.ts` is tempted to
  claim `deterministic_retrieval`, and `enforce_deterministic_claim` refuses it
  on any correlation that spent a model call — which, by the time a
  confirmation is written, is most turns. #237 found it on the task
  confirmation and fixed it THERE; the plan say-back, the Notion wiring and the
  teaching confirmation kept the hardcoded claim, so teaching the office a
  preference was stored correctly and then FAILED. One `howComposed()` for
  every caller, so the next confirmation added cannot be the fifth.
- **Conversational appearance is not provenance, and the context reaching the
  model could not say otherwise.** Three hallucination baits in one chat — a
  "Q3 pricing review document", a person called "Priya", a churn figure — each
  answered HONESTLY with *"there is no entry on that"*. Four turns later the
  office produced two calendar entries with clock times whose agenda items were
  those three baits: **its own denial that something existed became the evidence
  that it existed.** The cause is not the calendar and not the wording. By the
  time the model sees it the context is FLAT — a row the office holds, a
  document retrieved this turn, a fact Grant stated, a noun that exists only
  because a question contained it, and a sentence the office made up an hour ago
  all arrive as undifferentiated dialogue, and a model handed all five as
  dialogue uses all five as memory. `src/agents/provenance.ts` is the missing
  distinction, stated once so the prompt, the grounding and the output checks
  read the same definition rather than three approximations. Three rules fall
  out of it and each was independently broken: **the office's own prose is not
  provenance** (otherwise one fabrication launders every repetition of itself);
  **a claim about what the records CONTAIN needs a source that was actually
  read**, per DOMAIN, because retrieving a document says nothing about the diary;
  and **the handler needs canonical state**, because enforcing the invariant
  without it made *"what projects do we have open?"* unanswerable — and solving
  fabrication by making the office incapable is a worse product than the one
  that fabricates, since at least the fabrication is visible.
- **Every coherence gate keyed on a CLAIM, so a bare assertion was invisible to
  all of them.** "I checked", "I posted", "you told me" — three detectors, three
  verbs, and an answer that simply STATES two meetings with times trips none of
  them. When adding a gate, ask what shape of lie it cannot see; the answer here
  was "the confident kind, with no verb in front of it", which is the shape a
  good model produces.
- **What is checkable without a model is not truth but DERIVABILITY.** A margin
  of £26 follows from £40 and £14, so a number in general cannot be checked
  against its sources. A clock time follows from nothing, so it can. That
  asymmetry is the whole design of `fabricatedWhen`, and it is why the check is
  narrow on purpose: it will miss an invented name and an invented percentage,
  and it cannot fire on arithmetic, a quotation or a repetition of something
  Grant said.
- **A plaintext SETTING beside a password box will eventually hold a
  credential.** The Google form's Client ID goes to `system_config`, which the
  page renders straight back into the input's value attribute; the Client secret
  goes to the vault. Two adjacent boxes, and 0359 already records that Grant
  pastes into the wrong one — so the wrong paste stored a live secret in a
  plaintext table and printed it on the Settings page, in the DOM, and in every
  screenshot the harness takes. The fix is the class, not the field: sort the
  two values BY SHAPE so the form cannot be filled in wrongly (0359's own
  argument), and refuse a credential-shaped value in ANY setting, because the
  next plaintext setting added beside a password box is the one nobody
  remembers to check. And a refusal names the CLASS it recognised, never the
  characters: a prefix is public knowledge and what follows it is the
  credential.
- **A valid credential refused for an invisible reason is a UX defect, and
  `trim` does not remove what is invisible.** A zero-width space at the front of
  a pasted secret breaks a prefix match and there is nothing on screen to see.
  0359 learned this the expensive way — three refusals of a correct token — and
  `hq_set_google_secret` had been refusing valid credentials the same way ever
  since, because 0359's cure was never carried across. When a fix removes a
  whole class for one form, grep for the other forms.
- **A redraw that replaces every node takes the keyboard with it.**
  `drawShell()` rebuilds the shell, so pressing Return on a rail item navigated
  correctly AND dropped focus onto `body` — a keyboard user returned to the top
  of the document after every action, with nothing anywhere reporting a fault.
  `render()` remembers the focused element by its own identifying attribute and
  restores it, and only when the redraw is what took focus away. This is
  invisible to every audit that presses controls, because a pointer sets focus
  itself.
- **A dialog that does not own the keyboard is not a dialog.** Twenty-five Tabs
  with the document viewer open put focus on the shell behind it twenty-three
  times. Settings is deliberately NOT the same case — #158 made it a page, and a
  page you can leave by going somewhere else is the whole difference — so an
  audit asserting a focus trap has to know which of the two it is looking at.
  The first draft asserted it on Settings and reported correct behaviour as a
  defect.
- **The command bar is built from DATA, so every audit in this repository is
  blind to it.** `verify:wired` walks twenty-one screens collecting `data-*`
  attributes off rendered controls; the bar's rows are objects. It offered
  *"Desk — projects where you left them"* long after #77 removed the desk, and
  `view: 'desk'` matches no branch in `drawShell`, so it fell through to the
  home board: a row naming a screen that was gone and quietly taking you
  somewhere else. It was also MISSING two views the rail has. Assert the
  property in both directions, in a unit test, reading the drawable views out
  of the source rather than listing them.
- **A migration that applies cleanly is not a function that works, and four
  defects in one feature proved it in an afternoon.** 0390 declared
  `decide_suggestion`; the press could not work for four independent reasons,
  none visible from reading: it wrote a state the CHECK constraint forbids
  (`accepted` where the table allows `open | acted | dismissed | stale`); it
  assigned `app.learn`'s JSONB to a `uuid`; it accepted a scope of `agent`
  where `lesson_scope` has `staff`; and it stored three targets where
  `lessons_scope_matches_target` permits exactly one. Every one would have
  surfaced weeks later as a press that did nothing. **Drive the function.**
  Reading a migration proves it parses.
- **An offer may only promise what the press can perform.** The rule the four
  above all violate, and the reason `verify:rules` drives the offer AND the
  press for every scope the offer will accept. Two lists in two functions
  compared by eye is how they came to differ.
- **Re-read your own evidence through the filter you just built.** 0394's
  header argued from raw `inference_usage`: 211 calls at 17% on
  `office.instruction`. The view it created excludes harness traffic, and the
  same row is 9 calls at 78% — 204 of them were the certification runs. Fifth
  instance of harness traffic about to be reported as the office failing, and
  the first INSIDE a feature built to measure the office, which is the worst
  place for it: a measurement that cries wolf is one Grant learns to ignore.
  The query was run before the filter existed and never re-run against the
  thing that shipped.
- **A check whose floor is measured on the wrong element can never fire.**
  `verify:ui` had `if (chars < 40) 'rendered almost nothing'` for months,
  measuring `document.body.innerText` — which always holds the rail, the
  header and the switcher. The smallest screen reported 361. Pointed at the
  SECTION it became a real floor, and the same run then found that every
  settings pane reported an identical 476 (the project section behind the open
  Settings page) and that the "the call" route measured the help pane and
  pressed the microphone to get there, because #214 removed the call SCREEN
  and `drawShell` has no such view. Three defects, all in the audit, all
  surfaced by making the measure NAME what it looked at.
- **`Date.parse('2026-02-31')` is a perfectly good number.** JavaScript rolls
  the extra days into March. A guard whose comment claimed it rejected
  impossible days did not; a unit test found it in one run. Check a date by
  ROUND TRIP — the day that comes back must be the day that went in.
- **A function with eight arguments will be called with seven.**
  `app.task_add(p_project, p_title, p_detail, p_due_on, p_assignee,
  p_milestone, p_added_by, p_job)` — passing the job seventh sets
  `p_added_by` to a uuid, and the reversal keyed on `job_id` then matches
  nothing and reports "all of them" removed. Use NAMED arguments in SQL the
  moment a signature passes about four.
- **`app.task_add` returns `id`, not `task_id`.** Checking the wrong key made
  every successfully created task report to Grant as refused. The companion of
  guessing a column name, one level up: read the function's RESULT too.
- **`app.hq_undo` performs from a CLOSED case and raises on a verb it does not
  know.** So `app.undo_offer` naming a reversal nobody taught it is a control
  claiming something nothing performs — 0298's defect. Teach `hq_undo` the
  verb in the same migration that starts offering it, and drive the press.
- **An undo must not take back what the person did in between.** A reversal
  scoped to "the rows this job created" is right; scoped to a list of TITLES it
  is wrong, because titles normalise, collide, and a title he has since edited
  is missed while an identical one he wrote himself is caught. And it must
  leave anything he has started or changed, and COUNT what it left rather than
  implying it took everything.
- **Backticks inside a comment inside a template literal — five times in one
  session**, in `app.js`, in two verify suites, in a handler's SQL and in
  `verify/ui.ts`'s injected `MEASURE`. `check:templates` covers `web/**` only,
  so everywhere else it announces itself as an esbuild parse error pointing at
  a line some distance from the cause. If a comment sits inside a template
  literal, write plain words and say so in the comment.
- **An audit told to run in a mode must assert it is IN that mode.**
  `DENSITY=compact npm run verify:layouts` reported 64 states and 0 findings
  before the compact scale had ever been applied — the geometry pass never
  seeded appearance at all, only the contrast pass did. A mode that silently
  does not apply is indistinguishable from a mode that passes. The control
  (read the attribute back, compare to what was asked for) caught it on its
  first run and then the real run found a genuine 40px touch target.
- **A suite not in the gates for a change is a suite that will be red and
  unnoticed.** `verify:arrangement` broke the moment #25 turned the project
  Overview into a map — it asserts on `[data-panel]`, which is now behind a
  Map/Panels toggle — so ADR-0021's whole guarantee sat unverified for a
  morning. When a change moves what a screen OPENS ON, grep the suites for the
  selector that screen used to show.
- **A screen with no capture is a screen nothing is watching.** #25 made the
  project map the default and put the panels board behind a toggle, and the
  board immediately lost its entry in `npm run shots`. Within the same morning
  it had a ONE-WAY DOOR — the Map/Panels control was drawn in the map branch
  only, so choosing Panels removed the control that had just been pressed —
  and `verify:arrangement` had been failing against it unnoticed. Neither was
  found by reading; the door was found because a capture run FAILED waiting
  for a button that no longer existed. When a change moves what a screen opens
  on, give the displaced screen a capture in the same commit.
- **A panel below the fold in every capture is a panel nobody has judged.**
  The new history panel's date column rendered EMPTY in its first capture —
  the column the whole layout is built around — and then rendered "16 Aug"
  above "26 days ago", because `when.stamp` switches scale past a threshold.
  Right everywhere else in the product; in a column read top to bottom it
  looks like the sequence running backwards. Scroll the capture.
- **A substring check is satisfied by a superstring, so prove the detector
  can fail.** #268's check asserted `text.includes('jobId')`; the synthetic
  failure — rename every `jobId` to `jobIdX` in one caller — left it GREEN,
  because `jobIdX` contains `jobId`. It would also have passed on a file that
  merely mentions the word in a comment. `\bjobId:` with the colon is the
  property, because the property is that the option is PASSED. §10's harness
  audit is not ceremony: break it, watch it go red, restore it, watch it go
  green — and the first version failed that on its first try.
- **A control bound to a node that redraws itself works exactly once — three
  times in one file in one afternoon.** The icon picker's grid replaces its own
  `innerHTML` on every search, every category press and when the lazy library
  lands. A listener on each of 451 buttons, on the search box, and on the
  arrow-key handler all died at the first redraw. Only the third one announced
  itself honestly ("the arrows do not move focus"); the other two looked like
  features that had never been wired. **Delegate on the container that does NOT
  get replaced**, and note that `verify:controls` cannot catch this class — the
  audit presses each control from a fresh render, so a control that works once
  passes.
- **A roving tabindex decided per element cannot answer the question it needs
  to.** The chosen mark is the tab stop; if the filter excludes it, something
  else has to be — and you only know that after looking at every candidate.
  Deciding inside the render loop left every button at `-1`, so filtering the
  gallery removed it from the tab order entirely. Gather as data, decide once,
  then render. And a roving index with no arrow keys is WORSE than one stop per
  item: a gallery you can reach and cannot move inside.
- **A generated library needs a check that its CONSUMERS name things it
  contains, and the database cannot be that check.** `icon_defaults` maps a
  name term to an icon key; `app.icon_key_ok` validates the SHAPE, which is
  right for a free-text field and cannot answer "does this exist". Twelve
  defaults named real lucide icons absent from the 451 this office selected —
  and the migration's own header had already called that "the registry-row
  defect with a friendlier face", in the same file, in the same hour. A copy of
  451 keys in SQL would be a second place for them to rot (0310), so the check
  lives where both halves are visible: `npm run check:icons`, in the gate.
- **`let` three hundred lines below a hoisted function that uses it is the same
  trap as the one at the top of `app.js`, and it recovers so it is invisible.**
  `tickWaiting` is a function declaration, so `render()` reached it during
  module evaluation and threw "Cannot access 'ageTimer' before initialization";
  the studio printed "could not draw this screen" and the NEXT draw worked. One
  console line, no failing check, months old. A hoisted `var` would have hidden
  it rather than fixed it — the `=== null` guard would never fire and the ticker
  would never start. **Print page errors during every capture run**
  (`page.on('pageerror')`); it is how this one and #197's were found.
- **Filling a curated set to a quota from a loose signal fills it with
  puzzles.** lucide's tags exist to make a SEARCH find things, so they are
  generous by design; taking thirty per domain from them put `chess-king` under
  engineering and `mouth` under people. A name match is precise and a tag match
  is a top-up, capped — a domain with eleven good icons is a better page than
  eleven plus nineteen riddles. The same rule made a variant filter necessary:
  lucide ships `-off`, `-x`, `-plus`, `-check` and numbered siblings of nearly
  everything, and a project is not "briefcase, but crossed out". Reject the
  CLASS by suffix, never the names, or the next state it invents is back.
- **A "stalled" threshold taken from a duty's period says nothing about a
  person.** `app.jobs_stuck_queued` falls back to sixty minutes for a kind no
  duty creates, and `office.instruction` — how Grant's own messages arrive — is
  exactly such a kind, so his question was not "stuck" until it had been
  ignored for an hour. `waiting` (0406) reports the fifteen minutes the gate
  uses, BESIDE `stalled` rather than instead of it: "a duty is behind its own
  schedule" and "a person has not been answered" are different questions and
  the office needs words for both.
- **A gate catching an outage the dashboard cannot show is half a fix.**
  `verify:drains` would have caught the fifteen-hour outage; `app.office_health()`
  still had no representation for never-started work, so the screen would have
  said the office was fine. The suite now asserts the two AGREE about the same
  queue, because a red gate beside a calm dashboard gets resolved in favour of
  the dashboard.
- **A control that asserts what a QUERY saw is one step short of a guard.**
  `verify:drains` proved its `WAITING` query returned a row for an injected
  stuck job. A query seeing a stuck job and a suite FAILING because of one are
  different claims. The predicate that decides the live check is a named
  function now and the controls run their injected reading through it. Proving
  it end to end by leaving the job behind was not available: a job cannot be
  deleted (`job_state_transitions` holds it), so the proof would have left a
  permanent fifteen-hour-old stuck job in Grant's queue, injected by the suite
  written to prove his queue is not stuck.
- **A harness turn that has not answered YET is not a turn that answered
  nothing.** The session runner scored "the office actually answered (running)"
  on a job that took three attempts and outlived the wait loop — and it had
  answered well. Worse, every expectation below still ran, and
  `recipient_agent` is written BEFORE the answer, so "answered by the finance
  director" held for a job that had not finished: a harness reporting a turn it
  never saw, in green. There is a third verdict now, counted separately in
  both directions, because folding it into either is a lie about the product or
  about the run.
- **`purge:fixtures` RETIRED staff and never removed them, so the roster became
  97% debris.** Withdraw-never-delete is right for anybody who has done work
  and was being applied to rows that had done nothing. The safety is not a list
  the sweep maintains: 16 of the 19 foreign keys on `public.staff` RESTRICT, so
  a specialist who consulted, delivered, produced an output, learned a lesson or
  asked for a tool cannot be deleted and the history keeps its author. 276 rows
  became 8. Two corrections on the way: `tasks.assignee_staff` is a **uuid**
  however its name reads, and the only thing holding the last 55 was
  `staff_prompts` — a prompt written FOR a specialist before they did anything,
  which is derived data like the briefs the sweep already deletes.

- **A token block opened in the middle of another one is invisible in a diff.**
  #124's density commit wrote `:root[data-density='compact'] {` immediately
  above the base `:root`'s radius tokens, and the brace swallowed them and
  everything after: three radii, three glass tiers, both blurs, `--glass-edge`,
  `--halo` and the two type families became compact-only. **In the default
  density 44 rules reading `var(--r-card)` computed to 0** — every card,
  control and sheet had square corners, deployed, for a day. Not overflow, not
  low contrast, not small type, not a dead control; `verify:layouts` reported
  64 states and 0 findings over it, and a square card is a design somebody
  could have chosen, so the captures look plausible. Found only because #38's
  flat-card detector reads `--r-card` to find cards, got an empty string, and
  its **synthetic-failure control did not fire**. Put the closing brace on the
  block you open, in the same edit — and give every found-nothing check a
  control, because this is what one is for.

- **A suite's project is not named like a fixture, on purpose — so anything
  that fires on project creation fires for it.** 0416 enqueued a Slack channel
  when a dashboard project was created, guarded against `fixture-%`,
  `verify-%` and `ledger-proof-%`. `verify:identity` builds its subjects
  through `app.hq_create_project` as `identity-proof-<run>`, deliberately NOT a
  fixture name, because #45 says a suite testing a feature that FILTERS
  fixtures must use real subjects. **Six real channels appeared in Grant's
  workspace in two runs, and Slack cannot delete a channel.** The second
  failure was worse than the first: a project that has gathered a job can never
  be deleted, so the suite's own teardown started failing on
  `jobs_project_id_fkey`.
  The fix is TIME, not a longer list of names — enumerating the shapes a
  suite's project can take is the same mistake with more words, and the next
  suite picks a name nobody listed. What separates a test subject from a
  dashboard project is that one of them is gone in seconds: 0419 provisions
  only a project that is active, attached and **fifteen minutes old**, and
  nothing fires at creation at all.
- **A measure that matches nothing reports a perfect score.** `npm run space`
  answers "how far down is the first real content on a phone" and printed
  **0px — 0 screens of furniture above it**, which reads as an immaculate
  page. Its selector knew about panels and cards; #25 had turned the project
  Overview into a map, so on the one surface the measure exists for it found
  nothing and said so as a zero. Third instance of the found-nothing shape and
  the worst of the three, because this failure looks like success. A measure
  now NAMES what it measured to (`measured to .planeport`) and says
  `NO CONTENT FOUND` rather than printing a number.
- **A measurement of the harness is not a measurement of the product.** The
  same measure counted the 81px prototype strip — the one saying "showing
  invented projects", which only appears WITHOUT a token — as furniture on
  Grant's phone. 75% became 54% became **45%** as each wrong thing came out.
  Discount by height rather than by moving the measure, so a run with a token
  gives the same number.
- **Guessing a FUNCTION name costs what guessing a column name costs.**
  Rewriting the second half of `app.import_output` from memory invented
  `app.file_in_collection`, `app.tag_document(uuid, text)` and an `app.relate`
  signature nothing has; all three failed on the first real run. The real
  second half is one call to `app.approve_document`. Read the definition
  (`npm run qq`) before rewriting a function you are only patching.
- **An applied migration is immutable and `check:migrations` enforces it —
  including against you, ten minutes later.** Editing 0417 to fix the defect
  above failed with `[checksum/modified]`, correctly. The honest recovery when
  the file is minutes old, never committed, and its applied version is broken:
  delete the `app.schema_migrations` row, apply the corrected file, and SAY SO
  in the commit. The dishonest one is leaving a migration in the repository
  whose applied content nobody has.
- **The section reader nests its answer under `data`.** A check that read the
  top level reported "NO URL" about a URL that was there, and would have sent
  somebody hunting a signing defect that did not exist. Three times in one
  night the first draft of a CHECK was wrong rather than the product: this, the
  `mon` inside `month`, and two section names that do not exist. **Validate the
  test before believing the finding** is now the most-used rule in this file.
- **An SVG element's `tagName` keeps its own case; an HTML element's is
  upper-cased.** `verify:controls` names every control by its `textContent`,
  and every generated page illustration carries an inline `style` element
  INSIDE an `svg` — so nine document cards were all called
  `.pg rect { fill: var(--ink-3); opacity: .42 } .pg rect.accen`, the
  de-duplication collapsed them into ONE entry, and eight of the nine had
  never been pressed by the audit at all. The route reported 36 controls; it
  has 43. Filtering them out by comparing `tagName !== 'STYLE'` missed every
  one, and the finding printed the CSS straight back. Lower-case the tag name
  before comparing it, and remember that a screen reader does not read a style
  sheet either.
- **A control that cannot fail is not a control, and the way to find out is to
  break the thing on purpose.** The guard added with #121's `j`/`k` was proved
  by typing `jk journal` into the composer with the guard REMOVED — and it
  stayed green, because a textarea carries none of the walkable attributes so
  the walk declines on its own. The letter that actually gets stolen is the
  slash, which opens the command bar from anywhere. Same shape as #268's
  substring check satisfied by a superstring: the synthetic failure has to
  exercise the path the check claims to cover, not a neighbour of it.
- **An obligation is not a job, and four fixes each rebuilt that idea by
  hand.** `jobs.state = 'complete'` means ONE job stopped executing. Nothing
  meant "what Grant asked for has been done", so #312, #315, #316 and #317
  each reconstructed it from descendants and bolted the result onto
  `conversation_before`. Canonical traffic says the parent finishing first is
  not an edge case — **53 of 56 real parent/child pairs had the child finish
  AFTER the parent**, all 53 wrote something, 21 were delivered. And the
  aggregation already existed and had never been used: 40 `branch_groups`,
  **0 of them real**, 1055 real children outside any group. `app.fan_in_over`
  was wired behind `branchesStarted.length >= 2` while real traffic is 5138
  turns convening nobody, 2 convening one and **none ever convening two** — so
  the gate stood one above the only shape that happens. 0562 derives
  `app.obligation_state` across the tree (never stored, so no counter can get
  stuck and a terminal child cannot strand it), 0563 lowers both halves of the
  threshold, and a lone branch is RELAYED verbatim rather than synthesised.
- **Both halves held the same threshold, so lowering either alone did nothing
  — and said nothing.** `instruction.ts` gated at `>= 2` and `app.fan_in_over`
  refused `v_count < 2`. Lowering the TypeScript gate changed no behaviour at
  all, because the function returns `{error: …}` rather than RAISING and the
  caller had only a `.catch`. Third instance of 0282/0293 (loosening a
  constraint does not loosen the function that pre-checks it) sitting on top
  of the swallowed-write defect. **When a SQL function reports refusal in its
  return value, the caller has to read it** — a `.catch` is blind to it.
- **A slice is a substring, so a bounded window is part of the assertion.**
  A control sliced 2600 characters after `select app.fan_in_over(` and ran
  past the block into the record-consultation handler, which happens to
  contain `answer?.error` and `app.cannot` of its own — so a sabotage that
  gutted the fan-in's error handling left the check GREEN. #268's superstring
  trap in slice form, and the fourth vacuous control in two sessions. Bound a
  source slice by BOTH ends.
- **A date-dependent test is wrong one day in seven.** `verify:mytasks`
  seeded a task at `today + 5` and asserted only that "Actually make that
  Monday" CHANGED the date. On a Wednesday, today + 5 IS next Monday, so the
  office moved the task to exactly the date it already had and the suite
  reported a correct product as broken. Assert the PROPERTY — it ends up on
  the next Monday — and seed a day the answer cannot be.

- **Assert the CALL, not the NAME — three vacuous controls in one session.**
  #268 already records a substring check satisfied by a superstring. This is
  its commoner form: a test asserting `expect(source).toContain('asksWhoIsOnIt')`
  or `indexOf('const headCount =')` stays GREEN when the expression is replaced
  by `null`, because the import still names the function and the declaration
  still matches. All three passed their first sabotage and proved nothing.
  What discriminates is the wired expression — `firstOfHis(asksWhoIsOnIt)`,
  `const askedForAnother = wantsAnotherGo(instruction)` — because a sabotage
  that guts the logic must remove it. **A name appearing in a file is not
  evidence that anything calls it**, and the only way to know is to break the
  thing on purpose and watch the check go red.

- **`npm run lint` is `biome ci .`, which fails on FORMATTING.** A format
  failure prints as one unattributed "Some errors were emitted" a long way below
  the diagnostics, while every named finding above it is a warning — so the run
  reads as warnings plus an exit code nobody can account for. Two commits went
  out that way in one evening. Read the exit code, not the findings.

- **A shortcode is a name only one surface can resolve, so sharing the sentence
  shares the name.** `provenanceLine` is shared between Slack and Telegram on
  purpose (#186) and ended `:warning: *Nobody has checked this yet.*`. Slack
  resolves that against its own emoji set; Telegram's HTML parse mode resolves
  nothing, so eight characters arrived on Grant's phone as eight characters —
  and the same message said "nobody has checked this" TWICE, because the header
  line and the provenance clause are pushed under identical conditions. Both
  compile, both escape correctly, both are well-formed HTML, and the only thing
  that was ever going to find either was rendering four real shapes and reading
  them. When one function feeds two channels, ask which of its output is
  VOCABULARY rather than words — and when two lines are pushed under the same
  condition, one of them is a repetition.

- **A corpus that finds a defect has, by finding it, stopped being able to find
  the next one.** The bait corpus discovered the provenance defect and then
  influenced every line of the fix, so it is regression material and no longer
  evidence — and neighbours of it belong in unit tests, where 32 of them
  generated from the SHAPE of the fabrication cost seconds rather than minutes.
  A fresh corpus, written against a frozen implementation and committed BEFORE
  it runs, is the only thing that can answer "is there another one". The freeze
  is a commit hash, not an intention.

- **A payload gains a key and THREE places have to learn it.** 0420 taught
  `app.hq_governance` to return `requests`, the Governance page grew a section
  for it, and it rendered "0 open" over a database holding fourteen rows —
  because `GOVERNANCE` in `settings.js` did not carry the key and
  `hydrateGovernance` did not copy it. The renderer, the store and the
  hydrator each have to know, and the two that are not the renderer fail
  SILENTLY: `d.requests ?? []` is indistinguishable from an office with
  nothing to ask for. Nothing caught it — `smoke`, `check:templates`,
  `verify:wired` and `verify:layouts` were all green, and 64 layout states
  reported 0 findings over an empty section. Found by opening the PNG, which
  is the entire argument of §14A.

- **A control that is only drawn when a ROW exists is invisible to
  `verify:wired`.** Already recorded for a popover; this is the data-conditional
  variant and it is commoner. Approve and Decline are drawn per open request,
  the table had none, and the audit walked twenty-one screens and reported
  "no dead controls" without ever seeing either. Seed a row before believing
  a control audit has covered a feature.

- **An offer may only promise what the press can perform — and the comment
  claiming otherwise was written in the same hour.** The Governance page's
  Decline button sent no reason; `app.decline_tool` refuses one without
  (*"it is what makes it worth revisiting in three months"*), so the press
  returned an error and did nothing. The handler's own comment said "the RPC
  supplies an honest default", which was invention. Driving it over HTTP found
  it in one run. Fourth instance of a comment asserting a property with no
  check behind it.

- **A DURABLE decline means a suite cannot reuse its subject.** `decline_tool`
  silences a tool for three months (#49's whole argument), so the same fixture
  tool cannot be declined and then approved in one run — `request_tool` raised
  nothing the second time and the suite died on casting `''` to uuid. That is
  the product working, and a test written to need otherwise would have been a
  test arguing with a safety rule. Two fixture tools, one per verdict.

- **A registry reason is written for a person and lands in every prompt.**
  `tool_permissions.disabled_reason` for `web.search` is 398 characters and
  recites 0298's argument; nine of them were 2,027 characters of a capability
  brief that had reached 5,183 against a ceiling of 4,000 the suite had
  asserted all along — so `verify:capability` was red, and it is not in the
  gate, so nobody knew. The brief takes the first clause now. **A column
  serving both a page and a prompt needs the prompt's budget taken from it,
  not the page's.**

- **A fill alone is only a chip where the parent is a different colour.**
  `.govreqtool` was `background: var(--sunken)` and `.govcase.g-declined` is
  also `--sunken`, so on a settled card the tool name lost its shape entirely.
  Visible in one dark phone capture and in nothing else — no contrast failure,
  no overflow, no dead control. A border as well as a fill.

- **A dial with no reader is worse than no dial, because it looks like a
  decision.** `autonomy_settings`, `public.autonomy_level` and
  `app.autonomy_for(project)` were all correct and all complete, the Settings
  page could set the level, and **nothing in `src/` ever asked what it was** —
  `autonomy_for` sat in `check:callers`' baseline and the only two rows in the
  table were written by `verify:autonomy`. So Grant could tell the office to
  act on its own, watch it say it had, and get asked about everything anyway.
  #15's title is that sentence. When a setting exists, grep for the reader
  before believing the feature does.

- **The prototype and the product can hold two vocabularies for one enum, and
  only the prototype is what a capture sees.** `settings.js`'s fallback offered
  `ask | standing | wide` as autonomy levels; `public.autonomy_level` is
  `observe | suggest | act_with_review | act`, and `hq_autonomy_set` refuses
  the other three by name. The LIVE payload was right the whole time, which is
  exactly why nothing went red: with a token the page is correct, and every
  screenshot this repository takes is without one. 0311's two-words-for-one-
  thing, in the one place no suite is pointed at.

- **A floor belongs in a CHECK, not in a sentence.** #15 asks that destructive
  actions cannot bypass the policy. `autonomy_policy` is data Grant may edit,
  so the guarantee is
  `check (action_level < 3 or verdict <> 'proceed')` — a level-3 action can
  never resolve to `proceed` however the matrix is edited. The companion
  trigger refuses a standing authorization on a level-3 tool, because a CHECK
  cannot read another table. Both are pushed by `verify:approval` and both
  assert on the MESSAGE: a refusal for the wrong reason looks exactly like the
  rule working.

- **A standing authorization may upgrade `ask` and must not touch `refuse`.**
  The subtle door in the same feature: `observe` + a live standing row still
  refuses, or "watch this project only" would be undone by an exception Grant
  granted about something else. It is a one-line condition and it needs its own
  control, because nothing else in the suite would have caught it.

- **An offer may only promise what the press can perform — the blocker
  edition.** `handlers/drive.ts` had offered *"do not ask again"* as an
  approval option since it was written and nothing could honour it. The fix is
  two columns (`blockers.standing_tool`, `standing_option`) naming what
  answering grants, NOT a parser over `approval_options` — those are free text
  a handler composes in whatever English reads best, and deciding a permission
  by matching words in them would be #130's parsing defect on a security
  boundary. `raiseBlocker` throws when the named option is not in the list,
  because `hq_answer_blocker` refuses an answer outside it: a standing offer
  nobody could ever accept is the control that exists and cannot be pressed.

- **An issue number in a refusal the MODEL reads becomes an issue number in
  Grant's answer.** Seven outputs in thirty days opened *"Setting aside
  constraint #242."* — one of them an announcement email to customers. The
  prompt never mentions #242; the coherence gate does. Its refusal ends up in
  `pinned_config` so the retry can see it, which is the closed loop the gate
  needs, and from the model's seat the reference is part of the instruction.
  Eleven messages in `quality.ts` carried one and two carried a section mark.
  **A comment is for a person and a message is for a model**: the comments keep
  their references, the strings lose them, and
  `tests/agents/quality-messages.test.ts` reads the source and asserts it as a
  property so the next message added cannot bring one back.

- **A type assertion on a database row makes a NEW interface field look
  supplied.** `rows[0] as Omit<Speaker, 'reason' | 'alsoConvened' | 'convened'>`
  claims the row already carries everything else — so adding `handoff` to
  `Speaker` compiled green while one of the two return branches never set it,
  and the first live run died four attempts deep on *"Cannot read properties of
  undefined (reading 'to')"*. tsc cannot help: the cast is the assertion that
  it is fine. Add the new field to the Omit list, so the branch is forced to
  supply it.

- **`settled(state)` includes `failed`, so a check written with it can pass
  while the thing it tests has crashed.** `verify:sequence`'s first run
  reported *"the receiving agent answered in their own name — failed as
  communications-director"* as GREEN. #209's lesson in a different costume: a
  check satisfied by the subject having died is worse than no check, because
  the report says the question was asked. Assert `complete` where completing is
  the property.

- **A handoff carries the office's own prose, so it belongs in
  `answeredBefore` and never in `retrieved`.** #128 hands Emma's output to
  Oliver. `provenance.ts` excludes the office's own prose from `established()`
  precisely so one fabrication cannot launder every repetition of itself, and
  putting a colleague's draft in the retrieved list would launder it through a
  second agent instead — the same defect with a colleague added to the chain.
  Oliver may write up what Emma found; a figure of Emma's does not become
  grounded for him by having passed through her.

- **`text-overflow: ellipsis` needs all THREE properties and this rule had
  two.** `.govwall` set `overflow: hidden` and `text-overflow: ellipsis` and no
  `white-space: nowrap`, so the overflow never happened and the ellipsis had
  nothing to do: in a three-column grid `web.search` rendered as
  "web.searc / h" and `calendar.write` as "calendar.wr / ite". A dotted
  identifier split mid-token does not read as a tool name at all. No contrast
  failure, no overflow finding, no dead control — found by opening the capture.

- **A suite whose own rows are FIXTURES cannot assert that a reader finds
  them.** `verify:decisions` wrote every row as `verify:decisions-<run>`, which
  makes `is_fixture` true by generation, and then asserted that
  `app.decisions_about` returns them — a reader that correctly excludes
  fixtures, so four checks failed against a product that was right. The suite
  needs TWO authors: a real one for anything a reader must see (safe, because
  every section ends in `rollback`) and the `verify:` one for the single check
  that fixtures never reach a prompt. Ask which side of your own filter each
  row is on before writing the assertion.

- **`array_to_string` is STABLE, so a generated column containing it is
  refused.** 0425 wanted `ruled_out` in a weighted tsvector and Postgres said
  *"generation expression is not immutable"*. The reader matches the array with
  a trigram instead, where a stable function is perfectly legal — and the
  column comment says WHY it is missing, so nobody adds it back.

- **An approval option that cannot be acted on when it is answered is a dead
  control with a friendly face.** `handlers/drive.ts` has offered *"Add them to
  the project as source documents"* since #62, and
  `app.drive_watch_checked` advances the page token whether or not Grant was
  asked — so by the time he answers, those files are gone from the change list
  and the next run has nothing to act on. It was never able to work.
  `blockers.on_answer` carries what answering PERFORMS — a job kind and one
  payload per thing, written by the handler — for the same reason
  `standing_tool` carries what it GRANTS: reading work out of free-text options
  would be #130's parsing defect on a path that enqueues jobs.

- **`both` is a reserved word in Postgres** (`trim(both …)`), so a CTE called
  `both` fails with a syntax error pointing at the CTE name and nothing else.

- **The executor hands a jsonb column back as an OBJECT.**
  `JSON.parse(String(x))` on it produces `"[object Object]" is not valid JSON`,
  which reads like a corrupt payload and is a guessed shape. Accept either:
  `typeof v === 'string' ? JSON.parse(v) : v`.

- **A search that found nothing is only evidence of an absence when the index
  covers what is ATTACHED.** #257's whole complaint: Grant asked about a
  document in the project's linked Google Notebook and was told it could not be
  found. `consultedDomains` lets the office say "there is nothing in our
  documents" after an empty search, which is right — and becomes a lie the
  moment a connector is attached with nothing indexed, and nothing anywhere
  could tell the difference. `app.project_knowledge` NAMES every such
  connector, and the note the model reads is empty when coverage is complete,
  because a caveat on every turn is one nobody reads.

- **A renderer that calls `render()` from inside itself loses its own output.**
  `needMade` mirrors `needHistory`, which is safe only because a real request
  yields: the `await` lets the outer render finish before the redraw. With the
  answer already in hand there is nothing to await, so the inner render
  completed and the OUTER pass then overwrote the DOM with the markup it had
  computed before the store was filled. The block rendered in no capture at
  all, and nothing anywhere threw. When a lazy fetcher gains a synchronous
  branch, the branch must return the value rather than redraw.

- **A panel drawn only when a row exists is a panel the prototype must invent
  for, and inventing it in the wrong place is a fabricated link.**
  `needHistory` mocks on ANY failure, which is right for a story and wrong for
  an artifact: a signed-in user whose request failed would have been shown
  links that do not exist, which is the thing #260 forbids by name. The mock
  belongs behind "there is no token", the state the page already announces
  with its own strip — not behind "the request failed".

- **A comment asserting how the data is shaped is worth nothing without a
  query — and this one cost 69 of Grant's 90 Telegram messages.**
  `BOT_FOR_INBOUND` joined an unaddressed inbound command to a bot with a null
  `staff_slug`, and its own comment explained that *"the chief's bot is
  registered as the pager with a null `staff_slug`"*. **No bot row has ever had
  a null `staff_slug`** — all eight carry their person's — so the
  branch matched nothing and those commands could not be answered on Telegram
  at all. It looked fine because the pager answered them anyway; what was lost
  was the reply arriving in the thread, and the moment #258 existed, the
  ability to receive a FILE, because the pager has no attachment path. One
  `select` settles a claim like this and nobody ran it for months.

- **An offer may only promise what the press can perform — and
  `app.discard_document` has never discarded anything.** It writes
  `state = 'rejected'`; `documents_state_check` permits `draft`, `review`,
  `approved` and `archived`. So it raised 23514 every time, from inside a
  SECURITY DEFINER function, and #28's review gate offered two buttons of which
  one was real. The whole table is 98 approved rows and 5 drafts, which is
  exactly what a discard path that always throws looks like from outside.
  Found by trying to tidy up after a run, which is how this class always
  surfaces.

- **A structural check cannot see a collision.** The first PDF the office
  produced validated perfectly — header, trailer, every xref offset
  landing on its object, the right page count — and had the introduction
  printed straight over the title. The cover draws at absolute positions and
  never moves the cursor, so the page break saw an untouched page and did
  nothing. Everything §14A says about opening the image applies to a generated
  document exactly as it does to a screen.

- **A PDF uses two encodings and using one for both is the mistake.** A string
  inside a content stream is in the FONT's encoding (WinAnsi here); a string in
  the metadata dictionary is PDFDocEncoding unless it opens with the UTF-16
  byte order mark. An en dash written as WinAnsi 0x96 in the title is a control
  character to a reader, and Chromium showed the tab as "Legacy Coaching Course
  OE Current Status Report" while the same dash on the page was perfect.
  And anything outside WinAnsi with no stand-in becomes `?`: the first real
  report said "high?performing" because the model used U+2011, the
  non-breaking hyphen.

- **A length cap that cuts mid-word is the clipped content a layout is checked
  for, arriving through the guard instead.** A table cell read "client
  independe". Truncate at a word and say so with an ellipsis; a cell that stops
  at a word reads as a summary and one that stops mid-word reads as a bug,
  because it is one.

- **When two matchers can claim one sentence, extract the predicate rather
  than making one defer to the other.** #258's "write me a PDF report" was
  claimed by #260's LISTING matcher, because `LISTING` counts the word "what"
  wherever it appears and `report` is one of the artifact kinds — so the
  office answered a request for a document with *"Looking through the notebook
  for report — back shortly."* and made nothing. Deference is the obvious
  fix and it is a cycle; a shared predicate states the precedence once, and the
  precedence is that MAKING outranks ENUMERATING, because the second is
  answerable from the first's result and not the other way round.

- **`create table if not exists` against a name that is taken does nothing and
  says nothing.** #264's first draft called its table `events`; `public.events`
  already exists with 2,641 rows as the ledger of what the office DID. The
  migration applied against the existing table and failed on the first missing
  column, which is the cheap version — the expensive one is widening a table
  until the question it answers has no answer. Query
  `information_schema.tables` for the NAME before writing the create, the same
  rule as for a column.

- **A suite that deliberately parks a job in `retrying` races the live
  worker.** `verify:recovers` leaves one parked and asserts it, then dequeues
  ANY job in its scope two steps later — and `recoverStalled` calls
  `requeue_retrying` on every worker tick, so the parked job comes back as
  `queued` and is taken instead of the one the step just made. The stub runs
  against the wrong job, the output lands on the wrong job, and two checks then
  describe a job nothing ran. #184's coupling one layer out: a suite taking its
  OWN earlier work. Filed as #273 with the evidence; the whole gate reported
  15/22 and five of the seven failures pass alone.

- **The three fixed points of a `documents` fixture travel together.**
  `content` with a `content_fingerprint`, the fingerprint a **sha256**, and
  `fetched_at` iff content — three separate CHECK constraints, and a fixture
  satisfying two of them fails on the third. Four runs of one suite were spent
  discovering them one at a time. Read `pg_constraint` before writing the
  insert.

- **A data-modifying CTE's rows are invisible to the rest of its own
  statement, and a suite written that way reports the reader as empty.** The
  first draft of `verify:browser` created a project in a `with p as (insert
  …)` and called the reader in the same select: six checks red, all of them
  describing a reader that works. The tell is that the WRITER in the same
  statement succeeded — because it was handed the id directly and the reader
  had to look the row up. Put the setup in its own statement and reference it
  by slug; when a section needs a writer's answer AND a reader's, keep the
  writers' answers in a temp table, because only the last select comes back.
- **A drive that is not wrapped in a transaction writes to a real project, and
  an append-only table cannot take it back.** One `do $x$ … rollback` block
  behaved and its rewrite as a plain CTE did not, which put a permanent
  browsing row on one of Grant's live projects thirty seconds after the table
  existed. Recovered by disabling the ledger trigger, deleting the row and
  re-enabling it — honest for a row minutes old with nothing depending on it,
  and not a thing to do twice. #210's rule applies to a DRIVE exactly as it
  applies to a suite: wrap the call, not the assertion.
- **A suite can take its OWN earlier work, and the scope cannot stop it.**
  #184's `requested_by` scope keeps other suites out. It does not stop
  `verify:recovers` dequeuing the job IT parked in `retrying` two sections
  earlier — the deployed worker calls `requeue_retrying` on every tick, so the
  parked job comes back as `queued` and a later `mine()` takes it. The stub ran
  against the wrong job, the output landed on the wrong job, and two checks
  described a job nothing had run, while the dequeue check two lines above said
  "dequeued". Fixed at BOTH ends, because either alone leaves the class open:
  ask for a SPECIFIC job and settle anything else that arrives (a recurrence is
  then one named line), and settle a deliberately-parked job the moment its
  section has asserted it (which removes the race rather than detecting it).
- **A function you are only patching must be spliced from its LIVE definition,
  and this file already said so.** `app.pause_job` was rewritten from memory
  for 0457 and lost four behaviours in one go: `waiting_on` took the reason
  instead of the sentence a person reads, `state_reason` lost its prefix, the
  already-paused early return went, and **the job kept its LEASE** — so every
  paused job would have looked claimed until the lease expired. One suite check
  caught it. `pg_get_functiondef`, then change the one thing.
- **An `npm run` command Grant uses is a CALLER; a verify suite is not.**
  `check:callers` excluded all of `scripts/`, reasoning that a caller there is
  a capability he does not have. True of `scripts/verify/` and false of the
  rest — `check:leaks`, `eval` and `purge:fixtures` are in CLAUDE.md's own
  "Asking the office about itself". Eight baseline entries were reachable all
  along. The distinction is derived from `package.json` (an npm script that is
  not `verify:*`, `poc:*` or the gate), so it cannot drift, and the strict half
  is untouched.
- **Drop the WRAPPER first, and the check will tell you whether the function is
  dead.** Four functions of a superseded task API looked unused and "looked"
  is not evidence. The three public wrappers are certainly unused — PostgREST
  is the only thing that can reach a wrapper — so those went first, and
  `check:callers` then named `app.project_tasks` and `app.set_task_state` as
  reached by nothing at all. That is proof produced by the check rather than by
  reading, and it is the order to do it in.
- **`drop function if exists` with the wrong argument list matches nothing and
  says nothing.** `public.add_task` was dropped with six arguments and takes
  nine, so the migration applied cleanly and removed nothing — the same shape
  as 0350's Telegram branch that has never matched a row. Read
  `pg_get_function_identity_arguments` rather than remembering.
- **A word-boundary match cannot see inside a snake_case identifier, and that
  hid a security defect for the life of the feature.** `app.guess_reach`
  concatenated a tool's name and description and looked for `\mdelete\M`;
  `_` is a word character to Postgres, so `delete_everything` is ONE word and
  the destructive pattern could never match a name. **Every classification the
  office ever made came from the DESCRIPTION** — the half a hostile MCP server
  writes. `delete_contact` only looked right because its description happened
  to say "Permanently remove a contact". Split separators before matching, and
  apply 0304's asymmetry to authority: the NAME is evidence, the DESCRIPTION is
  a claim, and a claim may only ever ESCALATE.
- **A suite made only of refusals passes against a system that refuses
  everything.** `verify:connectors` proved discovery grants nothing, offering
  grants nothing and a disconnected provider grants nothing — and never once
  proved that a granted tool WORKS. Same shape as the judge that marks every
  answer poor scoring perfectly on a corpus of poor answers. Every negative
  needs its positive.
- **When there is no natural asymmetry, the test has to MAKE one.** #262's
  "permissions never union" is unmeasurable across today's roster, because all
  eight agents hold the same sixteen tools — a `staff_may_use` check would pass
  on a system where everybody can do everything. A fixture tool granted to one
  branch agent inside a rollback is what makes the question answerable.
- **The office is its own controlled third party.** #265 asked for a
  disposable MCP provider to discover against and the answer was already in the
  repository: `supabase/functions/mcp` is a real MCP server with real tools and
  a static bearer. A token minted for the run, used across the network and
  revoked in teardown is a genuinely real integration test that costs nothing.
- **A gateway section no page reads is the same defect as a capability no code
  calls, and `check:callers` cannot see it.** The trigger framework (#264) and
  the connector inventory (#265) were both built, verified and completely
  invisible — sections on `hq-api` that nothing ever fetched. The check walks
  DATABASE functions; a section is a key in an object. When a feature ends in a
  gateway section, grep `web/studio` for `read('<name>')` before believing
  anybody can see it.
- **A COMMENT IS NOT A CALL, and a dangling-reference check cannot tell the
  difference.** 0452 dropped `app.what_i_can_do` and left, in
  `app.hq_governance`, the paragraph explaining why the page no longer computes
  that list a second time — which is the thing that stops somebody putting it
  back. `verify:schema` read the explanation as the call and reported a
  correct function as naming something that does not exist. The check reads
  past comments now, and because removing text is the one way it could go
  quietly blind it counts what survives the strip and was proved still able to
  fail on a plpgsql function naming a table that is not there. A SQL-language
  function cannot be that control: Postgres parses one at creation and refuses
  it, which is why the defect only ever exists in plpgsql.
- **A suite that is the only caller of the API it tests is the defect it is
  meant to find.** `verify:tasks` drove `add_task`, `project_tasks` and
  `set_task_state` long after `task_add`, `hq_task_state` and `studio_tasks`
  replaced them — so `check:callers` could see the old family was dead only
  because a suite is not a caller, and removing it broke the one thing still
  pressing it. When a removal turns a suite red, ask whether the suite was
  pointed at the live thing before deciding the removal was wrong.

- **A judge that scores each answer and subtracts cannot detect a regression,
  and only a control says so.** #133's first build graded the old and the new
  answer 1-5 with #116's rubric; on one run the SAME text scored 1 and then 5,
  and a deliberately sabotaged set came back *"better 1, worse 0"*. The rubric
  is not at fault — it grades one reply against a standard, which is what
  `npm run eval` needs. The comparative question is easier and must be asked
  directly: show both answers blind, ask which is better, then ask AGAIN with
  the sides exchanged. Agreement is the verdict, a reversal is position bias,
  and six of the sixteen combinations are unscoreable, which is the instrument
  abstaining rather than failing.
- **A control that cannot distinguish its treatment from its baseline is
  measuring nothing.** The same degradation control then failed a second time,
  and the judge was NOT the cause: `npm run verify:judge` scores it 5/5 on
  clear pairs. Two of the four sabotaged cases were `/start` and a link
  confirmation, whose honest answer is already one line — so a four-word answer
  is barely different from the right one and the judge was correct to call it
  close. Requiring a substantive baseline is not weakening a control.
- **A suite that drives the real enqueue path with a real-looking actor
  produces jobs indistinguishable from Grant's — fifth and sixth instance.**
  `verify:history` (61 jobs) and `verify:transport` (29) both call
  `app.enqueue_inbound` on purpose, so `requested_by` is `telegram:grant` or
  `slack:U0HIST`, and BOTH witnesses miss it: `is_fixture` is generated from
  that string, and `app.harness_job` asks whether the PROJECT is a fixture —
  these land on real projects. `npm run replay` picked three of them as "real
  history", which is how they were found. 0342 added `%:verify-%` so a suite
  can name its ACTOR; where the actor is part of what is being asserted, the
  suite corrects its own attribution in teardown and ASSERTS it.
- **Chasing harness traffic by NAME fails; ask a property of the REQUEST.**
  Three rounds of excluding probe text from the replay corpus each found
  another shape. What worked is structural: a real request came through a real
  channel AND **its answer was actually delivered to somebody**. A harness
  almost never gets that far, and unlike a list of names it cannot go stale.
- **A replay can deliver to Grant through the work it SPAWNS.** Replaying
  "write me a PDF report" made the office enqueue `artifact.report` children
  with `announce = true` — a child inherits `requested_by` and takes the
  column DEFAULT for announce. Nothing reached him by luck: the fixture parent
  had no message to reply to. And an INSERT-only trigger is not enough, because
  `src/jobs/worker.ts` writes the handler's own announce decision back with an
  UPDATE after the run (0461, then 0462).
- **Retrieval returned the same document twice, and the rule to stop it had
  existed for months.** Every file on Grant's real project appeared once as
  `notebooklm` and once as `notion`, identical rank — the notion copy carries
  `mirrors_document_id` because the office WROTE it, which 0169 already calls
  "not new material". With five hits into an 8,000-character block, a corpus
  with sixteen mirrors spends half a turn's evidence saying one thing twice,
  and the answer cites one document as though it were two sources. A mirror
  steps aside only when its original is visible in the same scope.
- **Driving a function finds what reading it cannot — the symmetric half.**
  0465 marked, archived and un-marked a vanished source, and a source that came
  BACK stayed archived for ever. Four passes against real rows found it in one
  run; the migration read perfectly. Converging is symmetric or it is not
  converging.
- **A test that runs ONE attempt is asserting against the retry loop.**
  `verify:unified` reported NO OUTPUT and read as a product failure. The job
  had gone `running -> retrying` with "incoherent output metadata" — #185's
  coherence gate refusing one attempt, which is the gate working, with its
  refusal written into `pinned_config` so the next attempt can see it. Drive
  the office's own recovery, and report the attempt count.
- **The deployed worker can take a suite's job, and failing on that reports
  the office working as a defect.** #184's scope keeps other SUITES out; nothing
  keeps the live worker out and it ticks every minute. Wait for the job to
  settle and read the answer it produced — an end-to-end result through the
  real worker is stronger than the in-process one, not weaker.

- **A mechanism keyed on a table nothing populates is a feature nobody has.**
  `public.contacts` holds ZERO rows, and ADR-0037 calls a contact match *"the
  strongest statement of relevance the database holds"* — so #172's strong tier
  has never once fired on real data. The writer and the studio form both exist
  and capture an email, so nothing is broken; it is simply unused. Before
  reporting a derivation as working, ask how many rows the thing it derives
  FROM actually has. Same family as the dial with no reader and the column
  nothing writes.
- **His half of the conversation is invisible, and that decides what the
  question can answer.** Mail is associated with a project by WHO SENT IT or by
  the subject, so Grant's own replies — not from a contact, no alias inherited
  — belong to no project. Fine for "what has come in" and fatal for "what am I
  waiting on". The fix is the THREAD: one conversation, so if any message in it
  belongs to the project the thread does. Applied only where the thread is the
  unit of the question, never to the reader that feeds every prompt, because
  six negative controls are written against that reader's exact scope.
- **Take the counterpart's name from the last message and you will address the
  person who is not there.** The first draft of `mail_awaiting` named the
  thread's other party off its most recent message — so on exactly the threads
  Grant is waiting on somebody else, it read "waiting on Grant Rogers". Ask who
  the thread is WITH, which is the most recent sender who is not him.
- **The cache stores a recipient COUNT, not recipients**, deliberately
  (ADR-0037). So a cold outbound thread to somebody who has never written back
  has no signal at all and cannot be reported as awaiting a reply. That is a
  trade following from a privacy decision rather than a defect, and it is the
  boundary of what "outstanding commitments" can honestly mean here.
- **`biome ci` fails on FORMATTING and on IMPORT ORDER, and says so far below
  the findings.** Recorded once already and paid for twice more in one session:
  a commit went out with lint exit 1 because the findings above the failure were
  all warnings. `npx biome format .` names the file; `npx biome ci .` piped
  through a colour strip names the rule. **Read the exit code.**

- **Stopping a job's follow-on work does not take back what it already
  wrote.** 0461 and 0462 stopped a replay DELIVERING; nothing stopped it
  DEPOSITING, and three `artifact.report` children that finished before the
  cancellation left three near-duplicate PDFs in Grant's real Legacy Coaching
  Course project. Worse than clutter: `app.search_documents` excludes archived
  material and NOT drafts, so they were retrievable, and an answer citing two
  of them as separate sources is the provenance defect this repository keeps
  paying for — manufactured by the harness built to measure it. A harness that
  causes real work must sweep what that work produced, and assert the sweep.

- **A name collision makes an absence look like a presence.** `stop_job` had
  existed at the gateway since the browser work with nothing pressing it, and
  grepping the page for "stop" is reassuring and useless: `data-stop` in
  `app.js` is an unrelated click-propagation stopper and fills the file with
  the word. Grant could not stop a running job. Grep for the CALL
  (`act('stop_job'`), never for the noun — and `npm run check:pressable` now
  asks the question for every gateway action, because `check:callers` walks
  database functions and a gateway action is a key in an object.
- **Twenty-seven of them, which makes it a class rather than an oversight.**
  Document approve and discard (#28's review gate, with four drafts waiting),
  revoking a granted tool, un-archiving a project, all three MCP connector
  actions, collections, forgetting a browser session. Each is baselined with a
  REASON, because the honest three-way split is missing control / deliberately
  for an agent holding the bearer token (#13) / a reader the page does not
  need, and an entry with no reason is an admission.

- **Two doors onto one field, and only one of them writes the ledger.**
  `app.approve_tool` and `app.revoke_tool` append `tool.granted` /
  `tool.revoked`; `app.hq_staff_tool_set` — the TEAM PAGE's tick box, which is
  the control Grant actually uses — inserted or deleted the same
  `staff_tools` row and recorded nothing. 42 events of each on record, all of
  them from the request path, and every capability change made by hand was
  missing from the audit trail. The fix is not a second `append_event` beside
  the first: the second writer DELEGATES (0472), so a future change to what
  revoking means cannot land in one door and not the other. Before adding an
  event to a writer, grep for the other function that writes the same field —
  and ask which of them a person presses.

- **A reader whose filter names a state nothing writes returns nothing, for
  ever, and looks like an empty queue.** `app.awaiting_review` filtered
  `state = 'review'` from 0176 until 0471 — and NOTHING in this repository has
  ever written that state: a made document is inserted `draft`, and the four
  values the constraint permits are not four values anybody uses. So #28's
  review gate had a reader that could not match a row, in front of two gateway
  actions nothing could press. The found-nothing shape again, and the question
  that settles it in one query is what the table actually HOLDS
  (`select state, origin, count(*) ...`), not what the constraint allows.

- **A suite that reads its evidence only on the path it drove itself scores a
  correct answer as no answer.** `verify:unified` dequeued the job when it
  could and waited for the deployed worker when it could not — and the read of
  `public.outputs` sat inside the first branch, so whenever the live worker won
  the race the suite reported `NO OUTPUT` and two grounding checks failed
  against an answer that was right there in the table. Canonical evidence does
  not care which process produced it: read the row, not the return value of
  the path you happened to take.

- **740 jobs in twelve hours, asking for a channel that could never be made.**
  A debris project whose desired Slack name was taken by somebody else's
  channel was re-enqueued by `provision_missing_channels` on every tick, and
  `channels.ts` returned a courteous "somebody has to choose" — with
  `announce: true` — one a minute from 10:02 to 22:34. The handler's own
  comment said a conflict is "reported rather than retried, because neither
  gets better on a second attempt", and the enqueuer had never been told.
  **Both halves right alone; only their disagreement wrong**, which is the
  hardest kind to see and the third instance in this file. 0477 bounds the
  sweep to one attempt a day per project and skips a project with an open
  blocker about it; the handler raises that blocker once, so the office asks
  rather than repeating.

  **The claim that stood here — that Grant was spared those messages by an
  accident, because the job had no reply-to and no Slack destination — is
  FALSE, and it stood in this file for six days.** `public.deliveries` holds
  756 rows for that kind with `state = 'sent'`, `channel = 'telegram'` and
  `target_ref = 1386648496`, which is his real chat; 746 of them on 17
  September alone. Their message references are a contiguous sequence shared
  with `google.read_mail` and `tasks.remind` deliveries to the same chat on
  neighbouring days, which is what rules out a stub. **He received them.** One
  query settles a claim like this and the entry was written without it — this
  file's own rule about a baselined reason, applied to this file.

  And nothing was watching the CLASS. `check:leaks` asks whether HARNESS
  traffic reached a real destination; `app.office_health()` reports failures,
  stalls and waiting work, and a duty that runs perfectly and sends perfectly
  is none of those. `npm run check:chatter` is that witness, in the gate, with
  a ceiling of a hundred a day per kind — the busiest honest duty-day on record
  is `google.read_mail` at 48 — and it carries its own positive control: the
  September burst is permanently in `deliveries`, so the same predicate pointed
  at that window must still find it, or the query has stopped working.

- **#270 asked Grant for a scope his app has had since 5 September.** The
  Issue's premise was that `verify:slack` must leave one channel behind because
  the bot cannot rejoin a room it left. `conversations.join` works — the suite
  asserts it on every run and it passes. The survivor was an ORDERING defect:
  the lobby's `slack_channel_map` row was updated in the cleanup block that
  runs AFTER the assertion, so the check read a row Slack had already shut.
  Two neighbouring facts, both established by driving Slack rather than
  reasoning: `conversations.archive` really does need membership
  (`not_in_channel` from outside), and `chat:write.public` means leaving a
  public channel does NOT stop the app posting to it — so the lockout check had
  been asserting a Slack behaviour that no longer happens, and now injects the
  error through the same fetch seam the file already uses, with a control that
  proves the real client still reaches the room.

- **A settings pane fetches when it OPENS, so a capture cannot fake being
  signed in there.** The review queue's capture works by writing a local-only
  token and re-rendering; the same trick on the Connections tab draws nothing,
  because `render()` does not rebuild a pane whose `canWrite()` was already
  answered, and re-selecting the tab makes it hydrate against a server that is
  a static file server — so the page correctly shows an office it could not
  ask. The three provider controls are therefore absent from every sandbox
  capture by construction, and the honest place to prove them is
  `verify:connectors`, which presses all three through the deployed gateway.
  Do not leave a capture that photographs the tab you came FROM: wait for the
  section, never for a fixed pause.

- **A plpgsql body is parsed, not executed, so a spliced reference to the
  loop's own record variable survives CREATE and dies on first use.** 0474
  narrowed the proposal round with `for t in select … where t.kind <> …` — `t`
  does not exist while its own source query runs, and the function raised
  `55000: record "t" is not assigned yet` the first time anything called it.
  Two migrations applied cleanly over it. The columns belong to the SOURCE, so
  they are named plainly; and the reason it was caught at all is that the
  migration that fixed it DRIVES the function in a `do` block.

- **Every proposal on Grant's Governance page was a suite's fixture, and the
  reason was one missing caller.** `app.raise_proposals` turns recurring
  impediments into things he can answer (#49) and **nothing had ever called
  it** — so the only rows in `public.proposals` were the sixteen that suites
  raised with `p_include_fixtures => true`, and the section headed *What it
  wants* showed him nothing but test traffic. The fix is three-sided and all
  three were needed: a duty that runs the round (0473), a reader that filters
  harness names through one shared predicate `app.harness_label` (0473), and a
  teardown that sweeps the CLASS rather than its own run's prefix. Ask what a
  table actually HOLDS before believing a feature has ever produced anything.

- **Not everything an agent could not do is something a person can grant.**
  291 of 331 `not_capable` impediments are #185's coherence gate refusing an
  answer — the gate working. As proposals they read "Finance Director cannot an
  answer that matches its own evidence", seven times, and there is nothing for
  Grant to approve. `raise_proposals` skips the kind (0474). The neighbouring
  correction: a title built as `%s cannot %s` assumes `needed` is a verb
  phrase, and half of them are nouns — `could not:` reads correctly for both.

- **A suite testing a filter cannot name its subject the way the filter
  matches — #45's rule, in its sharpest form yet.** Filtering harness-shaped
  NEEDS out of the proposal round (0475) instantly stopped `verify:proposes`
  from being able to raise `fixture-need-<run>` at all, and the suite died on
  `array['undefined']::uuid[]`. Its subject reads like a real one now and
  carries the run token, which is what teardown matches.

- **A resumable pause reason with no check is one nobody notices is
  missing.** `dependency_wait` was left out of `app.resumable_now`, so the
  first live fan-in had three specialists finish and the synthesis sat `paused`
  for eighteen minutes with the answer never written. The suite had not asked.
  Assert the LIST of reasons that can be woken, not an instance of it.

- **A SABOTAGE THAT DID NOT APPLY IS NOT A PASSING CONTROL.** Twice in one run
  a sabotage silently failed — a regex that never matched because the
  declaration sat mid-line, and a shell heredoc that broke on quoting — and
  both times "the check did not fire" was the SABOTAGE failing rather than the
  check working. The second one would have recorded a detector as proven
  against #124's exact defect when it had never been shown it. **Print
  something from the sabotage that proves it landed** (`grep -c`, a `changed:
  True`) before believing what the check then says.
- **A security check that cannot fail is worse than no security check, and a
  re-render is how one gets that way.** A check asserted a pasted session jar
  was cleared after SUBMITTING. It cannot fail: submitting calls `refresh()`,
  which redraws the form, so the textarea being measured is a brand new node
  that was never filled in. Removing the clearing line left it green. Assert
  on the path where nothing re-renders — here, cancelling — and #197's rule is
  the general form: anything you need to know about "before" has to have been
  recorded before.
- **A BASELINED REASON IS A CLAIM ABOUT THE PRODUCT, and two in two days were
  false.** `section:studio` said SUPERSEDED and was fetched as the primary
  payload. `action:browser_session_establish` said "blocked behind the
  Cloudflare account" — and nothing about pasting a session Grant exported
  himself needs Cloudflare, so the Sources panel listed signed-in sites and
  offered no way to sign one in, for the life of the feature, behind an
  excuse. A documented excuse is worse than a bare gap: it stops the next
  person looking. Check a baseline entry's REASON the way you would check any
  other assertion.
- **An empty list is not the same as a list you could not read, and the UI
  gets this wrong in the direction that lies.** `needMine`'s catch turned a
  failed read into an empty bucket, so the screen printed *"Nothing due
  today"* under a tab reading *"Today 3"* — the counts and the list are two
  requests and only one had failed, with no unreachable strip because the
  office WAS reachable. `mailBlock` did the same thing by returning '' on no
  hits, so *"there is nothing in your email"* was a claim about a search the
  model had never been shown. **You may say you could not look; you may not
  say there is nothing there.** #257's rule is not about retrieval — it is
  about every reader.
- **And the fix for that can hide real content, so order the branches by what
  is TRUE rather than by what is new.** The trouble flag was checked ABOVE the
  rows, so a bucket holding three tasks rendered "could not load". Rows beat
  everything; the flag only decides what an EMPTY list means. Found by a
  capture reporting `rows 3, writer true, tasksInDom 0` — the store full and
  not one row in the DOM.
- **A capture harness that throws takes every later screen with it.** One
  unreachable selector killed twelve captures, and a screen with no capture is
  a screen nobody is watching — so the harness had been quietly un-watching
  most of the product. Report the gap and carry on; list what could not be
  captured, because an unrenderable screen is exactly the result #41 says must
  be named rather than omitted.
- **Anything set before an in-flight read resolves is something that read can
  undo.** A capture wrote a fixture while `needMine` was still fetching; the
  response landed afterwards, cleared the bucket and re-rendered. Three of
  four passes looked broken and one caught the fixture first — **that split is
  the signature of a race**, not of a missing control.
- **A job kind nobody enqueues is invisible to `check:callers`.** The whole
  browser tier — adapter, ledger, tab, sessions, budget, Stop — was unreachable
  from any sentence Grant could say, because nothing ever created a
  `browser.gather`. The check walks DATABASE functions and a job kind is not
  one. When a capability ends in a job kind, grep for the `enqueue_child` that
  starts it, and ask "how would he begin this" rather than "does this work".
- **A provider's vocabulary is not this office's.** NotebookLM answers
  `slide_deck` and `mind_map`; the office says `slides` and `mindmap`.
  Adoption stored the wire word and the page fell through to it, so a slide
  deck Grant made appeared on his Sources tab as **"slide_deck"**. Nothing
  failed — the unknown-kind fallback did its job over a type that is not new.
  Translate at the adapter boundary, once. And do NOT add a CHECK to enforce
  it: a constraint would turn a genuinely new provider type into a LOST
  artifact, which is worse than an ugly label. Assert the property instead —
  no stored value is a word the library is KNOWN to use.
- **A throttle is not an answer, and inside a wait loop it is not a failure
  either.** `ManagementApiExecutor` retries a 429 five times with backoff and
  then throws; a poll loop calling it bare died six minutes in and put a RED
  against the office's routing in the release gate for something the office
  did not do. Catch it, keep waiting inside the existing deadline, COUNT the
  retries, and if the budget is spent being throttled say "could not run"
  rather than reporting a verdict that was never reached.
- **Read the exit code — and `$?` after a pipe is the PIPE's.** Three times in
  one run `npm run x | tail` reported 0 while `x` exited 1, once making a
  failing 37-suite gate look green. Redirect to a file and test `$?`, or test
  `${PIPESTATUS[0]}`.

- **A regex refuted TWICE by the same real inbox, and neither wrong version
  announced itself.** #172's quoted-chain stripper was
  `^\s*On .{6,140}wrote:\s*$` — a whole line, which every fixture in the test
  file satisfied. Thirty live messages said five held bodies contained the
  attribution and **zero of them had it at the start of a line**, because
  HTML-derived text leaves it mid-line. Loosening it to a word boundary was
  the obvious fix, it shipped, and the next live run produced *the identical
  five*: `.` does not match a newline and a plain-text attribution WRAPS, so
  the address ends one line and `wrote:` begins the next. Both wrong versions
  compiled, passed thirty unit tests, and stored **86% more of Grant's
  correspondence than the office needed** — 7,354 characters a message against
  1,006 once it worked. What settled it each time was one query counting how
  often the matcher fires against real rows (`count(*) filter (where body ~
  'On [^newline]{6,140}wrote:')` beside the same pattern with newlines
  allowed): 0 against 5. **A regex that matches nothing is invisible; measure
  how often it FIRES, never whether it looks right.**
- **An assertion that enforces a posture goes red the day the posture is
  authorised to change, and deleting it is the wrong repair.** `verify:mail`
  asserted that `mail_messages` had no column a body could be stored in —
  correct under ADR-0037, and red the moment Grant authorised bodies. The fix
  is not to remove it: that would leave the most personal corpus the office
  holds with one fewer invariant than before. The replacement asserts what the
  NEW posture requires — a body never exists without the time it was taken, and
  its absence always names which of three reasons applies — and drives the
  three constraints rather than reading the migration.

- **Adding a search box to a list cached under its BUCKET NAME is silent and
  convincing.** `mine.lists` was keyed on `'today'`; #259's search would have
  typed a query, hit the cache, and handed back the unsearched list — which
  reads exactly like a search that matches everything. Keyed on the whole
  request (bucket, query, sort) instead. The second half is the part that
  actually bit: **the capture harness seeds that store directly**, so the
  moment the key changed it was writing to a name the renderer no longer read
  — `rows: 3` in the diagnostic and `tasksInDom: 0` on the screen. The fix is
  not to restate the rule in the harness but to EXPORT it (`window.__shots`
  carries `mineKey`), because a key computed in two places is the "row list
  built twice" defect with a cache attached.
- **A positive check cannot detect a filter that matches everything — only its
  control can.** Sabotaging `app.my_tasks`'s search to `where true` turned
  **one** of 57 checks red: "a query nothing matches returns nothing". Every
  *"the search finds it"* check stayed green, correctly, because a search that
  returns the whole table does find it. If the only checks on a narrowing
  feature are positive ones, the suite passes against a feature that narrows
  nothing.
- **`tasks.priority` is an integer where LOWER is more important and 100 is
  ordinary** — the live rows are 20 and 100, and `my_task_add` floors at 1. A
  first draft of `my_task_set` validated 1..5, which is a different scale with
  the same name: 0311's two-words-for-one-thing, in a column. And `tasks` has
  `added_by` not `requested_by`, `state` starts at `todo` not `open`, and
  `detail` is NOT NULL defaulting to `''` so clearing it is `''` and never
  null. Four guesses, all refused on the first run, all settled by one
  `information_schema` query.

- **The instrument was wrong three times before the product was wrong once.**
  #277's harness scored a textbook SUCCESS as the defect on its first run —
  the office had said *"I'm setting aside the request for a numbered list
  because your standing instructions forbid lists"*, which is the clause doing
  exactly its job, and the scorer called it spurious because `brokeAForm` was
  false. It then missed three more real acknowledgements in a row, each in a
  shape nobody had listed: *"in prose rather than a list because your
  instruction forbids lists"*, *"because MY standing instructions prohibit
  lists"* (no "you" anywhere), and *"I can't use bullet points as per your
  standing instruction"* (no contrast word). **Two of the three missed shapes
  fell on the CANDIDATE's side of an A/B**, which is the one way an instrument
  can be wrong that nobody notices: it would have produced a verdict in the
  direction of its own blind spot. Read the answers, not the tally — and when
  a detector needs a third widening, ask whether the DIRECTION of the result
  has survived every version, because that is more robust than any single
  number.
- **A prompt A/B needs both defects counted or it optimises into the other
  one.** #277 is the office apologising for a rule it KEPT; #231 is the office
  dropping one in SILENCE. Either alone is trivially optimisable and
  optimising either alone is a regression — delete the clause and `spurious`
  goes to zero along with the feature; make it shout and `silent` goes to zero
  and Grant gets an apology every turn. The candidate that "states the ordinary
  case first" took `spurious` from 0 to 0 and `silent` from 1 to 2–3 across
  five runs, never better. Rejected, and the baseline retained — which is why
  the clause was extracted to `say-what-you-dropped.ts` as a named constant
  rather than edited in place: the freeze is a string, not an intention.
- **`finish_reason=length` with an empty body is the reasoning budget, not the
  model.** Three cases came back blank with ~1,100 tokens spent before any
  content, at `maxTokens: 900`. Recorded once already about the judge and paid
  for again here; raising it to 2,400 fixed all three. An empty body scores as
  "said nothing", which in this harness would have quietly IMPROVED the number
  under test.

- **Five fixture connectors were on Grant's Connections page for two days, and
  nothing was counting them.** `app.hq_studio_settings` builds that list
  straight from `knowledge_connectors` with no fixture filter, so twelve cards
  included five named **"Fixture connector"** — left by crashed runs of
  `verify:knowledge`, whose teardown keys on its own run token and therefore
  could never collect an earlier run's. The fix is three-sided because any two
  alone leave it open: the reader filters the CLASS, the rows are swept by
  class AND age, and `check:leaks` gains a counter. It already counted probe
  providers, fixture tasks, harness tools and retired specialists and had no
  idea this table existed — **a debris class with no witness is one that comes
  back**, and this is the fifth table to prove it.
- **A `where` goes where the grammar puts it, not where the table name is.**
  The splice inserted the filter straight after
  `from public.knowledge_connectors k`, which is where the eye goes — and the
  next line is `left join lateral`, so the function became
  `from … where … left join …` and Postgres answered
  `syntax error at or near "left"`, naming a keyword three lines from the
  anchor. Splice after the JOIN.
- **A sabotage refused by a CHECK constraint is not a sabotage — sixth
  instance, and this one nearly recorded a vacuous control as evidence.** The
  row inserted to prove `check:leaks` could see connector debris violated
  `knowledge_connectors_disabled_has_reason`, so nothing was inserted, the
  check reported zero, and that zero was about to be written up as "the witness
  works". The insert's own result said `0 rows` and the proof line printed it,
  which is the only reason it was caught. **Print something from the sabotage
  that proves it landed, and read that line before reading the check's.**

- **An object literal evaluates in SOURCE ORDER, so provenance asked above the
  body is asked before the body spends the model.** Two handlers wrote

      return {
        path: await howComposed(db, job.jobId),      // counts zero
        body: announce ? await sayAs(...) : plain,   // spends one
      }

  `howComposed` asks exactly the right question — how many inferences are
  recorded against this job's correlation — one step too early. It answered
  `deterministic_retrieval`, `sayAs` then recorded an inference, and
  `enforce_deterministic_claim` refused the insert, so the JOB FAILED.
  `office.notion_sync` failed every two hours from at least 17:54 to 23:55 on
  18 September — **twelve of the office's sixteen failures in a day** — and
  Notion mirroring was silently not running. `office.sync` had the identical
  shape, and 0489's own comment in `notion-sync.ts` cites `office.sync` as the
  case it was written for: **0489 fixed the question and left the order**,
  which is why the failures continued after it shipped and after the worker
  was deployed. Hoist the body out of the literal: spend, then ask.
  `tests/agents/provenance-order.test.ts` scans every handler for the shape
  and was proved against the real file by putting the defect back.
- **Read the QUEUE before believing a green gate.** 36 of 37 suites passed
  while a real duty had been failing every two hours for at least six hours.
  No suite drives that handler's model-spending path, so nothing was pointed
  at it — `app.office_health()` said `failing_kinds: [{n: 12, kind:
  office.notion_sync}]` and one query found it. A release gate that only asks
  the suites is asking what somebody thought to write down.

- **A capability the office HAS and no registry row claims is one every agent
  is told it does NOT have.** 0298 added `delivered_by` because a row claimed
  `web.search` with nothing behind it, and named the other direction in its own
  comment without closing it. `capabilityBrief` builds every prompt from
  `tool_permissions`, so eight executable handler kinds named by no row were
  eight capabilities no agent knew about — `artifact.report` among them, after
  139 PDFs. Asked to improve one it had just made, the office answered *"I
  can't create a PDF directly in Telegram"* and offered a Notion page to export
  by hand. **The model was not hallucinating; it was reading its brief.**
  `check:capabilities` derives the kinds a CONVERSATION can start from
  `instruction.ts` and fails on any that no enabled row delivers — the boundary
  is derived rather than listed, so a kind added tomorrow is covered tomorrow.
- **Measure how often a text detector FIRES against real traffic before
  shipping it, never whether it looks right.** The first capability-claim
  checker drew its vocabulary from `tool_permissions.verbs` — prose about how a
  capability is used — and fired on **40 of 1292 real delivered answers, almost
  every one wrong**: "I'll pull it in" read as a false offer of `github.write`
  eight separate times. Four measured corrections got it to 5, all genuine:
  terms from the description's FIRST SENTENCE (0368's shape-describing
  paragraphs contribute "there" and "such"); an absence of RECORDS is not an
  absence of CAPABILITY; a limit of KNOWLEDGE ("I can't confirm") is not one of
  capability; and a denial needs a FIRST-PERSON subject, or "if the bought
  solutions can't reach your Notion" is a finding about somebody else's
  software. Folding `reach` in removed twelve more — `slack.post` is granted
  and Slack is `token_expired`, so denying it is true.
- **A grant is not a capability while the service behind it is down.** 0508
  asked that question of the roster; it has to be asked of the world too.
  "Capability temporarily unavailable" is already canonical in `reach`, and a
  checker that reads `tool_permissions` alone calls a true sentence a lie.
- **The office's own canonical refusal contains no modal, so every detector
  keyed on one is blind to it.** `blocked_capability` in `outcome.ts` composes
  *"I have not done this, and it is not something I can do"* — no can't, no
  cannot, no unable. Found by DRIVING the live suite, not by reading it, which
  is the whole argument for driving.
- **`origin_ref` is `chat:message`, and `app.conversation_before` threads on
  `split_part(origin_ref, ':', 1)`.** Two turns joined by a HYPHEN are two
  conversations, so a follow-up arrives with no antecedent and the office
  answers, correctly, *"this is the first thing you have said to me here"*. A
  harness testing a follow-up must share the part before the colon.
- **An obligation is not a job — counted the wrong way round, again.** A live
  suite counted `artifact.report` children of the SECOND job and reported zero
  on a run where the office had just delivered the report and said so.
  `enqueue_child_once` attaches restated work to the obligation the first turn
  opened. Count over the conversation, never under one job id; and while the
  first attempt is still IN FLIGHT, #316 correctly refuses to duplicate it, so
  a suite must SETTLE it before asking again.
- **Gate the invariant, report the outcome.** Driven three times, the same
  follow-up produced three different second turns — the report delivered, a
  question about what "where" meant, and `blocked_needs_user`'s "I understood
  what you want and could not carry it out". None denied the capability. Gating
  on "work started" would fail one run in three, and #226 records what an
  intermittent suite reads as. The deterministic half belongs in a unit test.
- **Adding a capability to the registry changes EVERY prompt, and the brief has
  33 characters of headroom.** Registering two capabilities took it from ~3700
  to 4199 against the 4000 ceiling `verify:capability` asserts, and tightening
  the verbs got it to 3967. A borderline unrelated behaviour moved in the same
  run (`verify:mytasks` 88/89, in #259's "call it X" disambiguation, with the
  recogniser ruled out by a negative control). A registry row is prompt
  surface, not just data.

- **A VETO MUST BE AT LEAST AS GROUNDED AS THE THING IT VETOES.** `changesHis`
  reads Grant's own words through `firstOfHis` — #313's rule — and `titleReply`
  read `instruction`, which `resolveAgainstThread` replaced two thousand lines
  earlier with a MODEL PARAPHRASE. So a rename grounded in what he said was
  guarded by a check grounded in what a model made of it, and the guard
  vanished whenever the rewrite drifted: "The task should be called X" and
  "Set the title of the new task to X" both return null from `titleReply`, the
  veto disappears, and the office answers *"I am not sure which task you
  mean"*. Three other rewrites keep the veto and corrupt the TITLE. Reproduced
  with NO MODEL AT ALL by putting plausible rewrites through the pure function
  — which is the cheapest reproduction in this file and was available the
  whole time. #313 established the rule and `namedLater` was never brought
  across; grep for every reader of `instruction` when you add one.
- **Establish WHICH PROMPT a hypothesis implicates before believing it.** #322
  was filed saying the capability brief was the likely cause, because two
  registry rows had just been added and a neighbouring check went red in the
  same run. One grep settles it: `capabilityBrief` has exactly ONE consumer,
  the answering prompt at `instruction.ts:4987`, `cap` is built at 4803 —
  AFTER every decision in the cascade — and `src/agents/thread.ts`, which
  produces the rewrite, never receives it. **The brief could not have caused
  it.** A correlation in time between a change and a red check is not a causal
  path, and the causal path is usually three greps away.
- **A gate that is red BY DESIGN teaches people to skip it.** `check:leaks`
  exits 1 on the two deliveries #298 deliberately preserved as evidence, and
  will for as long as they are preserved — so a fresh session read the red
  exit as a live containment failure and filed a duplicate issue. The guard is
  in fact working: 236 refused, 0 escaped since 21 September, the sent count
  unchanged at 2. When evidence must be kept in a table a gate reads, the gate
  needs a way to say "2 known, 0 new" or it stops being able to say anything.
- **`verify:mytasks` needs 597 seconds, three inside the ten-minute ceiling.**
  It exceeded 580 twice and reported nothing about the section under test.
  Give it the full timeout, and when a suite passes the ceiling, split it
  rather than reading a timeout as a result.

- **A GUARD READING THE REWRITE HAD NEVER FIRED, AND THE COST WAS WORK RATHER
  THAN WORDING.** `const aboutTheWork = asksWhoIsOnIt(instruction)` decides
  whether a status question convenes anybody, and its own comment says *"the
  shape is a whole short sentence by construction"* — true of what Grant typed,
  false of what reaches it. `resolveAgainstThread` had already expanded
  "who have you got on that" into *"Who have you got on the task of providing
  Grant with a view of the budget impact of the venue change and a view on
  sponsor participation?"*, which the pattern correctly declines because it is
  anchored to a sentence ending in a referent. So the guard declined, the
  hand-off ran, the quality director was convened a SECOND time and a second
  synthesis spawned — to answer a question `app.conversation_work` already
  held. An elliptical follow-up is the only shape that guard was ever going to
  see, and the expansion is exactly what the resolver is for, so it had never
  fired in practice. #322's rule one reader further out, and the tell is the
  same: the action was grounded in his words and its guard was not.
- **Fixing the recogniser changed nothing live, and that was the useful
  half.** Widening `asksWhoIsOnIt` to catch "who have you got on that" was
  correct, deployed, and the next run convened two people again — which is what
  sent the search upstream to the guard's INPUT. A fix that provably lands in
  the code and provably does not change the behaviour is evidence about where
  the decision really is; ship it, re-run, and read the non-result.
- **A corpus of one-to-four-turn sessions cannot find what the mechanisms do to
  each other.** Every session in the corpus isolates one property, which is the
  right shape for finding a defect in one mechanism and blind to the defects
  above — both found in the FIRST run of a twelve-turn conversation with two
  projects, work started, part finished, called off, repeated and corrected
  under it. `long-day` is that session. Length is a coverage dimension.
- **`document` was admitted only as "document for", so the plainest request
  there is matched nothing.** "Write me a DOCUMENT ON where the venue thing has
  got to" fell through to prose and the office answered *"I understood what you
  want and could not carry it out"*. Beside it, every request form was an
  imperative to MAKE something, so "I WANT a one-pager" was declined although
  `one-pager` was already in the noun list. Two gaps, one sentence, and #320's
  whole capability registration cannot help when nothing recognises the ask.
  A bare `summary` is deliberately still NOT a file — "give me a summary of
  what Emma said" wants a sentence, and answering it with a PDF is the worse
  error of the pair.
- **The session corpus runs on `teamhq` and Grant mostly works on Telegram,
  and the two do not scope projects the same way.** A session declares the
  project per TURN; the real surfaces SWITCH scope — 202 switches on record,
  163 of them `telegram_chat`, 34 Slack, 5 dashboard. So an undeclared
  follow-up in the corpus lands on the catch-all project `unnamed` (1157 jobs,
  72 of them real) while the same follow-up on Telegram inherits his scope.
  Anything a session concludes about project continuity is a conclusion about
  the dashboard path only.

- **A guard that PERMITS may not read a paraphrase — the fourth instance of
  the class, and the first where the grounding rule is asymmetric.**
  `wantsAnotherGo` is the only thing in this office that turns off
  `enqueue_child_once`, and it read `instruction`, which
  `resolveAgainstThread` replaces eighty lines above the gate. Every pattern
  in `again.ts` is anchored to a whole short sentence — the shape an
  elliptical follow-up has, and exactly the shape the resolver expands. Driven
  against the live resolver on a real thread, BOTH directions happen: *"try it
  again"* became *"try the view on what the venue change does to the budget
  again"*, which the recogniser declines because the referent is fifty
  characters and `IT` caps at forty; and *"give it another go"* became *"Ask
  them again."*, which authorises a duplicate he never asked for. #327 could
  afford a disjunction because its guard SUPPRESSES; this one permits, so it
  is `resolved.from ?? instruction` outright — always his own words, never the
  paraphrase. And a decision like this is passed DOWN rather than re-derived:
  `planAndPursue` took `goalAsHeSaidIt`, which is named for what it mostly is
  and is the resolved text, correctly, because a plan needs the referent
  expanded.
- **"Remind me to write the one-pager" is a reminder, not a one-pager.**
  `artifactRequest` and `personalTaskRequest` both fire on that sentence — on
  his own words, no resolver involved — and the artifact reading was taken
  first and vetoed the task outright, so the office produced the document and
  never added the reminder. Performing it now is the one answer that defeats
  the request: he had just said when he wanted to do it. The mood of a
  sentence is set by its main clause and the making is the OBJECT of the
  reminder — the fourth time this file has recorded that shape, after a
  complement clause read as a condition, a delegation's span read as three
  intents, and *"suggest when we should decide"* filed as a standing
  procedure.
- **The office offered him the choice and then took it for him, in the next
  sentence.** Asked the same thing twice — #316's measured real shape, two
  identical PDF requests three minutes apart — one reply said *"You asked me
  that a moment ago and it came back … Say the word if you want it done again
  from scratch"* and then *"Writing that up as a PDF"*. `alreadyOn`'s own
  comment two thousand lines above already said *"do not start a second one"*,
  and the three branches that START work had never been told. The structural
  door cannot help: `jobs_one_live_per_idempotency_key` is partial on LIVE
  jobs, deliberately, so once the first report completes a second is
  permitted, and by the three-minute mark it has. A narration that describes a
  decision nothing enforced is worse than no narration, because he believes it.
- **A status question answered well is a status question that started no
  work, and a harness asking one learns nothing about duplication.** The first
  draft of `verify:another-go` asked *"a view on where this has got to"*; the
  office answered it outright from the project's documents, so zero children
  either way and both the negative control and the authorised turn were
  vacuous. **Choose a subject the mechanism under test can actually act on** —
  here the sentence #316 was measured on.
- **The positive control of a containment suite is REAL-LOOKING by design, so
  it is invisible to every witness that reads attribution.**
  `verify:escapes` sends as `telegram:grant` on purpose — otherwise the
  control proves nothing — and two of its children still carry that, which is
  why a query for "real specialist answers that were never delivered" returned
  them. It rewrites its own parents in teardown and the children were missed.
  The rule is #45's, one level out: a suite testing a filter cannot name its
  subject the way the filter matches, so it corrects the attribution AFTER the
  assertion rather than before it — and it must correct all of it.

- **A lexical marker matched inside a fixed phrase whose meaning is the
  opposite, and the result sat in every prompt for eight days.** `STANDING` in
  `teaching.ts` contains the bare word `never`, so *"Okay, never mind about
  that."* was stored as a standing instruction at 0.95 confidence,
  `learned_by grant`. `dimensionOf` returns null for it, so `withdrawsARule`
  returns null too, so neither the retraction branch nor the nothing-to-drop
  branch in `remember()` could fire. `remember()`'s own comment names that
  exact sentence as something a fix prevented — the fix was elsewhere and the
  sentence would have been stored again today. Same shape as `\mdelete\M`
  unable to see inside `delete_everything`. Three parts, because any one alone
  leaves it open: the code, a check in the gate over the rules the office
  actually holds, and the row RETIRED rather than deleted.
- **Fixing the writer does not fix what is already stored, and nothing was
  looking.** `check:leaks` asks whether HARNESS lessons reach a real prompt
  and had no opinion about whether a REAL one makes sense. A rule the office
  would not accept today is one nobody meant to give it, whatever route it
  took in — so `npm run check:standing` reads the live set and fails on any,
  with a control that refuses to pass on an empty set. Ask what a table
  actually HOLDS: three live rules, and one of them was nonsense.
- **A scoped lookup makes the office deny what it is holding.** `believed` in
  `remember()` is scoped to the level the turn is at — deliberately, so a
  project rule cannot retire a global one — so from inside a project, a global
  rule is invisible and withdrawing it answered *"I do not have a standing
  rule about that"* about a rule in the prompt that composed the sentence.
  #320's invariant family, and Grant works mostly on Telegram where a project
  is usually in scope. Naming the rule is honest whatever he meant; RETIRING
  it needs him to have said everywhere, because "stop doing that" inside one
  project is genuinely ambiguous and guessing the wide reading undoes a rule
  for every other project.
- **Three arguments were enough to be passed the wrong way round for the life
  of the feature.** `app.retract_lesson(p_lesson_id, p_why, p_by)` writes
  `body = p_why` and `learned_by = p_by`; `remember()` passed the author
  second, so every retraction the office has ever written holds the AUTHOR in
  the reason column and the REASON in the author column. `lessons.is_fixture`
  is GENERATED from `learned_by`, so a suite's retraction carried reason text
  there and was attributed as Grant's — 41 global and 34 project rows reading
  as real traffic. Found because a hand-run retraction was refused by
  `lessons_body_check`: the constraint caught what no test did. CLAUDE.md's
  named-arguments rule says "the moment a signature passes about four"; it is
  **three** when two of them are text.
- **`public.lessons` refuses UPDATE, so a swapped column is permanent.** The
  honest response is not to find a way round the trigger: 0567 records the
  fact in the column comments, where somebody writing a query against those
  rows will see it. A ledger you can correct is not a ledger.

- **An order Grant gave arrived in the prompt as a belief to weigh, and he
  told the office twice.** He taught it to answer in bullet points on 11
  September, complained on the 20th and again on the 21st — *"You're still not
  respecting my request"* — while the rule was stored, live, at 0.95
  confidence and reaching the brief. It arrived under *"These are beliefs from
  past work, not rules — weigh them"*, beside lessons a specialist had guessed
  at 0.50. `remember()` already knows the difference and says so in its own
  comment; `guidanceFor` selected `body`, `scope` and `observations` and
  dropped `learned_by`, so the one fact separating an order from a guess was
  discarded at the query. Measured: 14 of 32 real answers used a list since he
  taught it, **0 of 4 on the days he complained**, 3 of 3 after the fix. The
  repair is the LABEL, not another paragraph — the prompt already says to
  honour his standing instructions, and a second paragraph arguing the same
  point is what #277 is a complaint about. **What a column knows is worth
  nothing if the query that builds the prompt does not select it.**
- **Choose the next thing to look at by reading what he actually said, not by
  listing plausible territories.** Two candidate areas were dropped on one
  query each: project switching mid-conversation has happened ONCE in real
  traffic, and no real message of his contains "again" or "remind". Forty of
  his own messages named the defect above in his own words, and it was the
  most repeated complaint in the corpus.
- **A teardown that only runs on success is not a teardown.** Two aborted runs
  of a new suite left four ACTIVE fixture projects, and the office listed them
  back in an answer. Arm the sweep the moment there is something to sweep, and
  use `process.exitCode` rather than `process.exit` so it is allowed to
  finish.
- **The project spine shows a harness job the harness's own world, on
  purpose.** `(app.harness_job(jobId) or not is_fixture)` — so fixture
  projects in a harness answer are the filter working, not a leak. Check which
  side of that predicate your turn is on before reporting one.

- **His morning briefing was mostly harness traffic, in both of its headline
  numbers, and nothing was counting.** The failure section held exactly two
  rows for five days and both were `verify:notice` debris — a suite that
  attaches its proof signature to a REAL job on purpose, so 0491's guard on
  `last_job_id` cannot see it by construction. And *"54 items are waiting on
  you… 50 more sit on the dashboard"* was 67 open blockers of which 63 were
  suites' and four were his, because `public.needs_me` had no harness filter
  at all and has EIGHT consumers — the dashboard and the voice answer said the
  same thing. Both fixed at the CLASS: `app.recurring_failures` now ignores a
  kind the office has never run (the writer composes it from `jobs.kind`, so a
  real one always matches), and the view asks `app.harness_job`, which is the
  fourth reader 0355's rule has had to be carried across to. **Ask what a
  surface actually SAID to him, not whether its code looks right.**
- **Filter one half of a sentence and you must filter the other.**
  `app.needs_me_pressure` is the *"N more sit on the dashboard"* clause and
  read `public.blockers` directly, so from the moment the view was fixed the
  two halves counted different populations. Fourth instance of both-halves-
  right-alone in this file.
- **A blocker with no job is KEPT by both filters.** 0304's asymmetry decides
  the direction: a witness that can only ever exclude cannot hide a genuine
  request, and "I know nothing about this" must not become "this is harness"
  on the one surface he uses to see what needs him.
- **A suite that goes red on a correct filter may be asserting an artefact.**
  `verify:autonomy` compared the view's count to the global open count as a
  proxy for *"the view does not truncate"*. The property is that nothing is
  CAPPED. Making both halves one population restored it without weakening it —
  the alternative, relaxing the check, would have removed the only guard on
  hiding items from him.
- **This executor returns the FIRST statement's result, not the last**, so a
  `begin; write; write; read; rollback;` batch hands back the write's answer
  and a control reading it reports the product as broken. And three upserts in
  ONE statement all read the pre-statement snapshot — three rows at `seen = 1`
  rather than one at 3. Both found by driving the writer by hand after the
  suite disagreed with the product.
- **`app.failure_seen` BLANKS a subject that is not lower-case, digits,
  underscore, dot, colon or hyphen** — so a subject with a space in it is
  stored as `''` and a reader looking for it finds nothing, for ever. The
  hand-drive that found this also left a real `drive.watch` signature in
  Grant's briefing until it was swept.

- **A citation scheme is PROVENANCE, and the office had no word for its own
  work.** `documents.connector` is nullable; **all ten null rows are
  `origin = made`** — the documents this office produced — so five real
  citations read `null:b8f72c15-...` and `report.ts` renders a source as
  `label - ref`, printing the word **null** on the sources page of a PDF Grant
  opens. The null was never missing information. Ask what the null rows have in
  COMMON before treating a null as an absence: here they were a category, not a
  gap. And a null connector is not UNTRUSTED — fencing the office's own
  document as somebody else's material is the mirror defect, which is why
  `isUntrusted` returns false for it explicitly rather than by falling through.
- **One format written in three places will disagree, and only one of them is
  the one he reads.** `sourceRefs` and two separate lists in
  `handlers/artifact.ts` each interpolated the scheme themselves. The same
  shape as the row list built twice and the two lists in two functions compared
  by eye: one formatter, every caller. The test asserts the WIRED CALL
  (`citationRef({ connector: d.connector` appears exactly twice) rather than
  the import name, because a name appearing in a file is not evidence that
  anything calls it.

- **He sent a 17-second voice note and the office never said anything.** 8
  September, his real Telegram chat. The transcription path threw, the job
  retried to attempt 4 of 5, moved to `failed`, and `deliveries` for it holds
  ZERO rows. Every terminal failure in `worker.ts` ended `moveTo(job,
  'failed')` and returned. #211 taught the coherence gate to record an
  IMPEDIMENT — a Governance-page row, a screen he has to go and look at — and
  stopped one layer short of this file's own rule that anything ending a turn
  with no answer has to say so somewhere he looks. A Governance row is not
  somewhere he looks when he asked on Telegram. **Silence on a voice note is
  the worst case of the class, because it is indistinguishable from never
  having been heard.** Fixed at the single tick seam, with the "who is owed"
  decision in SQL (`app.owed_a_word`) so six gates cannot drift apart, and the
  sentence composed in CODE — a turn that died possibly BECAUSE the model was
  unusable is the worst moment to ask a model for an apology.
- **A "CONTROL" given nothing to be wrong about is the vacuous control this
  file keeps recording, and it happened while writing the test that guards
  against it.** `capabilityLies(apology, EMPTY_CAPABILITY)` has no capability
  to lie about, so it stayed GREEN under a sabotage that made the sentence say
  "I cannot do" outright — and it was about to be written up as proof the
  office's own detector approved the wording. The pair is what makes it a
  control: the real sentence must pass AND a denial of the same capability must
  fail. **An instrument that is always silent satisfies every silence
  assertion.**
- **Challenge the corpus before building on it — three assumptions died in one
  pass.** "457 real blockers resolved" was 450 rows saying *"Resolved by the
  verification script"*. "Real provider outages never reach the pause path"
  came from a classifier matching the word *unavailable* inside an unrelated
  refusal sentence. "Four real turns of his died silently" was one probe, two
  turns with no inbound row, and **one that was genuinely his** — and that one
  was worth more than the four, because it was a voice note. All 224
  `job_pauses` rows are harness, so that whole territory has no real frequency.
  The pass's product change came from the single surviving row.
- **`office.%` matches `office.instruction`, which is how his own messages
  arrive.** A control written to prove a duty owes him no apology used that
  prefix and failed the migration on the one case the function exists for. The
  duties are in `public.responsibilities`; read them from there rather than
  guessing at a prefix.

- **`requestBody` takes the verb BY POSITION, so anything that hands it text
  which is not a request clause loses that text's verb.** Its contract is
  explicit in its own comment — a request opens with the asking verb, so "add
  a task to chase the roofer" correctly loses "add". A RETRACTION survivor has
  already had everything up to the change of mind removed, so it opens with
  the INSTRUCTION's verb, and composing the two ate it: his real voice note
  *"…No actually, you know what? Scan the entirety of the Legacy Coaching
  Project…"* was titled *"the entirety of the Legacy Coaching Project and
  create appropriate tasks for me to review"*. Both halves right alone and
  only the seam wrong, which this file already calls the hardest shape to see.
  **Before piping one extractor's output into another, check whether the
  second one's PRECONDITION still holds.**
- **A fix already in the code, with a comment citing the exact row, can still
  be wrong on that row — so drive it before filing a duplicate.** `taskTitle`
  carried a retraction fix whose comment quoted the very task title being
  investigated. Testing it took one scratch script and showed it half-working.
  Reading the comment and moving on would have left a live defect behind a
  convincing citation, which is the baselined-reason lesson in a code comment.
- **A generalisation that breaks tuned neighbours is a NEGATIVE RESULT worth
  recording, not a failure to hide.** #321 asks for the title's verb to
  survive everywhere; using `OBJECT_NOUN` as the discriminator generally broke
  six frames ("remind me to…", "put a to-do on to…") because they reveal no
  task noun after one verb is removed. Reverted to the narrow evidenced fix
  and the finding written onto the issue, so whoever does the full job starts
  one experiment ahead rather than repeating it.
- **A duty that has only ever said "nothing to do" is either correct or
  blind, and one query decides which.** `tasks.remind` runs every fifteen
  minutes and has never sent him anything. It is CORRECT: seven real open
  tasks and **not one has a due date**. Ask what the table HOLDS before
  reporting a silent mechanism as broken — and the real finding is the other
  way round, that nothing is putting dates on his tasks.
- **A timeout is not a result.** `verify:mytasks` exceeded the ten-minute
  ceiling again. What it reached (75 ok, including the check under test) is
  reportable; "the suite failed" is not, and neither is "the suite passed".

- **Every gate asked whether the office was ENTITLED to speak, and none asked
  whether what it said MATCHED what it was handed.** Grant asked *"what
  projects have we got"* six times on 23 September; five answers listed his
  four, and the sixth said *"I can't list any projects — I have no record of
  them in our database… if you can point me to the source (Notion page, Drive
  folder, etc.)"* — from a prompt carrying all four names, with byte-identical
  metadata to the five that were right. `assertsRecordsUnseen` permits it
  because `projects` WAS consulted and complete; `EPISTEMIC` exempts it
  because a denial is framed as what the office knows; every other gate keys
  on a CLAIM and a denial asserts nothing. `deniesWhatItHolds` is the missing
  question, and 0304's asymmetry is what makes it safe to run on every turn:
  **it can only fire when the census is NON-EMPTY**, so an honest absence can
  never be suppressed. `documents` stays out, because a search is not a census.
- **Pass the census as DATA, never parse it back out of the sentence you
  composed.** Reading "4 of them" out of `projectSpine`'s wording would be a
  wording lock across two files — the seventh instance this file would have
  recorded. `holds: { projects: n }` cannot drift.
- **`enqueue_inbound` composes `requested_by` from `<origin_channel>:<subject>`
  — the SUBJECT, not the actor — and a probe that puts "grant" there is a REAL
  job that will message him.** This file already stated the rule and I still
  got it wrong, because "actor" is the field that reads like the author. What
  caught it was asserting `is_fixture` and `app.deliverable_to(job, channel,
  his chat)` BEFORE letting the job run, rather than after. **Assert
  containment before the work, not in the teardown** — afterwards is a report,
  not a guard. It survived on a fake chat id, which is luck, and luck is what
  0350's Telegram branch was too.
- **A sabotage that stays GREEN is the most useful one in the set.** Three
  sabotages on #342: two went red and the third — making the handler stop
  supplying the census — did not, because nothing asserted the wiring. The
  gate would have gone silently inert while every unit check kept passing.
  An optional field is exactly where this happens: `holds?` absent means "no
  opinion", which is indistinguishable from "not wired".

- **The instrument said the anti-hallucination gate had never fired, and it
  had fired 54 times on his real turns.** `npm run measure` printed
  `evidence blocks 0` for the life of the measure, counting
  `job_impediments.kind = 'missing_data'` — a kind **no gate has ever
  written**. All four `app.cannot` sites in `worker.ts` write `not_capable`
  and identify themselves by `noticed_by` (`the handler`, `the quality gate`,
  `the output constraints`, `the worker`). `missing_data` holds 112 rows, none
  real, so the figure was zero BY CONSTRUCTION. The label claimed one thing
  and the query counted another — the wrong-payload trap, inside the tool
  built to make the office legible, and in the worst direction: a zero there
  reads as *the office never hallucinates*. **Count by the thing that RECORDED
  the event, not by the vocabulary of what was missing**, and print a LIST, so
  the line cannot go silently to zero the next time a gate is added.
- **Chase a dormant agent to its evidence before calling it a routing
  defect.** `finance-director` has never been chosen, which looks exactly like
  #230's ceiling defect. It is not: the subject matcher scores them top on a
  finance question, the ceilings were opened by #230/#232, and only 3 of 89
  real delivered instructions name finance first — two predating the fix and
  the third answered *"I can't bring Finance in without knowing what she
  found"*, which is #320's "needs information" state and correct. **A small
  corpus looks identical to a blocked route until you ask how many turns could
  ever have gone there.**

- **Derive a check from the code that COULD act, not from the data that has —
  and it paid on the first run.** `app.hq_undo` dispatches on
  `reversal ->> 'action'` through a CLOSED case and raises on anything else.
  Four names the writers record were missing from it, covering 34 rows. A
  check written over `undoable_actions` would have stopped there;
  `npm run check:undo` reads the WRITERS instead and immediately found two
  more — `document_move` and `document_restore` — which have **no rows at
  all**, because nobody has moved or superseded a document yet. They would
  have raised the first time Grant did. **A defect waiting for its first user
  is invisible to every query over history.**
- **Third instance of "an offer may only promise what the press can perform",
  and this file already named this exact function.** The tell was a near-miss
  vocabulary: `hq_undo` knew `contact_fields_set` while the writer recorded
  `contact_update`. Two words for one thing (0311) on the mechanism Grant's
  *"always check before making any destructive action"* depends on. Every
  performer already existed; only the dispatch was missing, which is why
  reading either half alone looked fine.
- **Three theories died before the real one, and one of them was my own
  regex.** `undo_offers` is a VIEW showing only LIVE offers, so zero now is
  expected rather than damning; the 4-minute window with no message per
  correlation is correct for dashboard actions, where the undo id returns in
  the action's own response; and `hq_overview_base` looked like a writer that
  never returns an id because `undo_offer` matched inside `undo_offers` in its
  overview count. **Validate the test before believing the finding** remains
  the most-used rule in this file.

- **He says "notebook"; the planner required the word "project", and the whole
  creation clause vanished.** Both `NEW_PROJECT` and `NAMED_PROJECT` read
  `(?:notebook\s+)?project\s+(?:called|named|titled)` — the notebook
  optional, the **project required** — so *"Create a new Google Notebook
  project called X"* planned and *"Create a notebook called X"* did not. The
  say-back then reads *"Make slide deck from the sources in that notebook"*
  with no antecedent, invites a go-ahead, and the artifacts are made in
  whatever project he is scoped to. That is what he actually received on 11
  September: five clauses became *"Make slide deck from it"*, and the office
  asked *"Shall I make it in Legacy Coaching Course?"* about a notebook he had
  asked it to create. **A pattern written around the one sentence somebody
  used is a pattern that works for that sentence.**
- **An old output is not evidence about current code.** That exact sentence
  plans correctly today — three steps, with the research and the links
  declared as dropped — and I nearly filed the September transcript as a live
  defect. Run the real input through the real function before believing a
  historical symptom; the class was live, the instance was not.
- **A sabotage that reverts half a `??` fallback chain proves nothing.**
  Reverting either project pattern alone left all five tests green, because
  the other still matched. Only reverting BOTH turned them red. When a fix
  touches two alternatives of one expression, the sabotage has to remove both
  or it is exercising the neighbour.
- **`say-what-you-dropped` reports clauses it RECOGNISED and could not map,
  never one it failed to parse.** So a clause the reader cannot see at all is
  dropped in the one way the mechanism built to prevent silent drops cannot
  report. When adding a recogniser, ask what happens to the sentence it does
  not match, not only to the one it does.

- **A suite signs its own messages and nothing read the signature — 20% of
  "his" conversation was a test.** `app.harness_job` read three signals and a
  suite driving the REAL enqueue path defeats all three ON PURPOSE: #45
  requires real subjects, and `enqueue_inbound` composes `requested_by` from
  the SUBJECT. The marker was `inbound_commands.dedupe_key`, written by the
  adapter that received the turn, and the namespaces separate completely —
  `teamhq`, `slack`, `telegram`, `voice` and `asset` each on their own
  channel, and **`verify` spanning three**, which is the signature of a suite
  impersonating all of them. 35 of 173 turns, only 12 of them probe-shaped by
  name, so a name list would have missed 23. **When a harness is
  indistinguishable by attribution, ask what it wrote in a column only an
  adapter writes.**
- **And the containment GUARD asked the same blind question as the
  measurement.** `claim_delivery` calls `harness_job`, so six `verify:chaos`
  deliveries reached a real Slack channel and his real Telegram chat, and
  `harness_escapes()` did not count them because it asks it too. Widening the
  predicate made containment STRICTER — but the cost of a false positive is a
  real message suppressed, so the migration asserts that **not one** command
  in a real channel namespace became harness.
- **A check that fails on the UNCLASSIFIED rather than guessing found a real
  message on its first run.** The new namespace guard flagged `asset:` — which
  turned out to be a genuine dashboard message of his asking for a document
  review. Stopping the gate on something nobody has classified is the right
  behaviour in both directions: guessing "harness" suppresses a message he is
  waiting for, and guessing "real" hides test traffic in his numbers.

- **Only suite teardowns delete `public.inbound_commands`, and a job outlives
  the row that proves whose turn it was.** No product path, no retention
  sweep, no SQL function — every deleter is in `scripts/verify/` or
  `scripts/poc/`. A job can never be deleted, so **68 of 206** turns counted as
  real have no evidence of their origin, and `app.owed_a_word` cannot reply to
  one either. Preserve the EVIDENCE at the moment it is destroyed: the BEFORE
  DELETE trigger is the last instant the dedupe namespace is legible. The
  inverse of 0310 — do not store a fact you can read, but when it is about to
  become unreadable, storing it is all that is left.
- **The database refused to let me stamp `jobs.synthetic`, and it was right.**
  *"synthetic is decided when the work is created and cannot be changed (f ->
  t). The defect this refuses is a suite rewriting its attribution around a
  send."* When a safety rule refuses your fix, the fix is wrong: preserve
  evidence, never a verdict, and keep the signal add-only.
- **A negative control that cannot be built is a fact about the product, not a
  gap in the test.** `app.stamp_synthetic_inbound` denies by default —
  *"anything that did not come through a production door is synthetic,
  whatever it calls itself"* — so every command a migration can insert is
  already synthetic. The first drive failed with A REAL TURN WAS STAMPED,
  which was the FIXTURE being wrong. Build the control that can exist and say
  plainly which one could not.
- **A migration whose drive block raises to undo its fixtures takes the DDL
  with it**, applies nothing, and reports success on its own marker. A job
  cannot be deleted, so leaving them is not the alternative. The tool is a
  plpgsql SUBTRANSACTION: an inner `begin … exception when others` block rolls
  back only itself, and re-raising anything that is not your marker keeps real
  failures real.
- **`measure` said "a gate stopped an answer of his" about 46 DUTY runs.** An
  earlier pass of this programme published "54 real turns"; the truth is 7.
  *"A gate stopped an answer"* and *"an answer OF HIS"* are different claims,
  and an instrument that conflates them will be quoted as the second.

- **A tool DESCRIPTION is written in the third person, and `\mdelete\M` does
  not match "deletes".** `app.guess_reach` classifies a discovered MCP tool
  and `app.offer_mcp_tool` turns that into an authority level — `destructive`
  is level 3, which `autonomy_policy` can never resolve to `proceed` and which
  cannot take a standing authorization, while `unknown` *"is treated as a
  write"* by that function's own comment. So *"Permanently destroys the
  archive"*, *"Wipes all local state"* and *"Charges the customer card"* were
  all offered as writes. The imperative worked and the third person did not —
  and the third person is how every API reference in the world writes a tool
  description. **This is the same word-boundary trap as `delete_everything`,
  one inflection further on.**
- **On an authority boundary, widen only in the escalating direction and say
  so.** A false escalation costs a human decision about a third-party tool
  nobody has vetted; a false relaxation hands a standing authorization to
  something that deletes. For the same reason "queries" is still deliberately
  unrecognised: failing to see a READ leaves the tool `unknown`, which is
  treated as a write — more conservative, not less.

- **`check:callers` counted a mention inside a COMMENT as a call, on BOTH
  sides — and the repository half masked its own fix.** `app.raise_suggestions`
  was reported reachable for as long as it existed, because the only database
  mention was a block comment in `app.decide_suggestion`; nothing produced a
  suggestion and the Governance page's *noticed* section could never populate.
  Then a comment added beside the NEW call named the function in prose, so the
  control that removed the call stayed green. `verify:schema` learned "a
  comment is not a call" once and it was never carried across to the check
  whose whole job it is. Stripping comments surfaced four more functions the
  product names only in prose. **When you add a call, do not also name the
  function in the comment beside it** — the check cannot tell them apart.
- **The shared database is shared, and another branch's migration lands in it
  before its file does.** Four `sign_in_*` functions appeared mid-run, from a
  0577 applied SIX SECONDS after my own 0577 by a concurrent session. A check
  over "what is in the database" will go red over work that is not in this
  checkout, and the right rule is ownership: **if no migration here creates
  it, this checkout cannot be asked to name its caller.** It self-heals when
  that branch merges. `check:migrations` already models this and passes —
  0539, 0543 and 0577 are recorded cross-branch collisions, and renaming one
  *"would make the repository claim a number it did not run under."*
- **0474 fixed two defects and neither was carried to the sentence beside
  it.** The proposal round learned that `needed` is half nouns (`could not:`
  reads for both) and that `not_capable` is the coherence gate WORKING. Three
  days later the suggestion round still said *"We have been unable to an
  answer the database will accept 46 times"* and still offered gate refusals
  as capabilities to grant. Both invisible because nothing had ever run it.
  **When you fix a composed sentence, grep for the other place that composes
  one.**

- **A guard decided from a proxy while the real number sat one join away.**
  `app.mail_coverage` computes `associated` — how many cached messages a
  project actually matches — and the `MailCoverage` interface did not carry the
  field, so `mailCoverageNote` asked `contacts > 0 || aliases > 0`: *could* this
  project match, not *did* this search cover anything. All five of Grant's
  active projects match **zero** of 274 cached messages and every one has at
  least one alias, so the note was suppressed on **100% of real projects** — on
  the exact turn the office is about to say something about his email having
  established nothing. The same class as `learned_by` dropped from the
  guidance query: **what a column knows is worth nothing if the code that
  builds the prompt does not select it.** And the original guard's argument —
  *a caveat on every turn is one nobody reads* — was right and was being
  decided by the wrong number; keep the argument, change the input.
- **A DEFAULT on a parameter is the same defect as a parameter no caller
  passes, with a friendlier face.** `mailBlock(hits, coverage = null)` let
  `handlers/artifact.ts` call it with one argument for the life of the
  feature, so the path that WRITES A DOCUMENT was never told what the office
  could not read. Removing the default turned one silent omission into a
  compile error at every site — the handler and ten test calls — the moment it
  was gone. Prefer required, and let tsc name the sites.
- **`count(*)` over a set-returning JSON function counts the ARRAY.**
  `select count(*) from app.mail_for_project(p, 50)` returns 1 for every
  project, which reads as "each one matches a message" and is the opposite of
  the truth. `jsonb_array_length` is the question. Third harness error in one
  pass, and the one that would have inverted the finding.
- **A coverage reading taken with a NULL project is not a reading about a
  project.** `app.mail_coverage(null)` reports `aliases 0`; per project they
  are one to three. Generalising the first to the second produced a confident
  wrong diagnosis, and the correction is what produced the real one — which is
  this file's most-used rule arriving from the other direction.

- **A TABLE the product writes and nothing reads is #72's shape in a fourth
  vocabulary, and nothing was walking tables.** `check:callers` walks database
  FUNCTIONS, `check:pressable` GATEWAY ACTIONS, `check:capabilities` HANDLER
  KINDS. 0274's own comment had already named it about `failure_signatures` —
  *"the mechanism built and the mouth forgotten, which is #72's shape and which
  this repository keeps producing"* — and it produced it again: a thumbs up or
  down on Telegram or Slack writes `public.feedback`, which has NO reader
  anywhere, and moves `notification_events`, whose only reader
  (`app.notification_patterns`) has no caller. Both Settings cards told Grant
  the press was read. `npm run check:consumed` is the missing witness, in the
  gate: 122 tables, 2 written and never read, each with a reason.
- **A sweep for unread tables is wrong until it counts VIEWS, OPERATOR COMMANDS
  and PostgREST as readers — three false positives before one true one.** View
  definitions cleared `notebook_budgets` and `notebook_capability_probes`;
  #272's operator rule cleared `preference_instructions`, an audit ledger
  `npm run levels` reads; and `/rest/v1/<table>` cleared `slack_workspaces` —
  55 rows with an edge function reading it on every Slack event, reported as
  never read because a REST fetch names no FROM and no JOIN. **A table read
  over PostgREST is still read, and a SQL-shaped pattern cannot see it.**
- **The same false claim, in the next card, phrased so the grep missed it.**
  0580 fixed `app.hq_studio_settings`' Slack sentence by searching for the word
  *feedback*. The Telegram card promised the same thing in different words —
  *"teaches the office something"* — and survived, found only by reading the
  function's LIVE OUTPUT rather than trusting the search. Grep for the CALL, not
  the noun, is already in this file; this is its prose form, and a settings card
  is one of the few places the office speaks to Grant with no model in the way.
- **A baselined reason is a claim about the product — the THIRD false one.**
  `app.notification_patterns` was excused with *"npm run levels and the learning
  page answer the question a person actually asks"*. Neither names it: one grep
  of `scripts/` and one `pg_proc` query settle it, and the only row returned is
  the function itself. A documented excuse is worse than a bare gap because it
  stops the next person looking.
- **`npm run lint` had been RED on the branch for several passes and nobody
  noticed — third instance.** Three `noTemplateCurlyInString` ERRORS sat under
  25 warnings, and the failure prints as one unattributed *"Some errors were
  emitted"* far below them. All three were legitimate (`${...}` quoted verbatim
  inside a sabotage anchor, and a test building the defect it checks for), so
  the fix is a suppression with a reason, never a rewrite. **Read the exit
  code** — and `biome ci` fails on FORMATTING and IMPORT ORDER too, which is
  what the last two of those five errors actually were.



- **A WITNESS THAT ASKS THE SAME PREDICATE AS THE GUARD CANNOT REPORT THE
  GUARD'S BLIND SPOT — they agree, and they are both wrong.**
  `app.claim_delivery` refuses a harness job a production destination and
  `check:leaks` reports when one gets through; BOTH ask `app.harness_job`. 0574
  taught that predicate to read the inbound command's dedupe key with
  `split_part(key, ':', 1) = 'verify'` — the FIRST segment — and a voice turn's
  key is `<channel>:turn:<who>`. A suite driving the live voice webhook produced
  `voice:turn:verify-basecamp-live-…`, sat in the third segment, and **14 jobs
  were answered as Grant's own voice notes and delivered 20 messages to his real
  Telegram and Slack**, while `check:leaks` said *"new escapes: 0"* for
  seventeen days. The other signals were all CORRECT and none helped:
  `is_fixture` is generated from `requested_by`, which is
  `<origin_channel>:<subject>` and so `voice:grant`; and `synthetic` is false
  because a suite calling the real webhook genuinely IS a production request.
  Assert that two independent predicates AGREE, never that one of them is happy.
- **`app.harness_label` already existed and 0574 wrote a narrower test beside
  it.** It anchors on both `^verify-` and `:verify-` for exactly this reason.
  Two vocabularies for one idea is what 0311 was spent undoing; when you need to
  ask "is this harness", call the predicate rather than writing a third way of
  asking.
- **`app.harness_job` EXCLUDES rows from the readers Grant looks at, so a
  predicate that is too GENEROUS hides his real work.** That is the reverse of
  0304's asymmetry and the expensive direction here: a missed harness job costs
  a contaminated measurement, a false positive costs him a real answer. Anchor
  on the separator, and drive BOTH directions — a real call sid, a real Telegram
  key and a real Slack key must all still be claimable. The guard was proved on
  a real escaping job inside a rollback (`suppressed`) beside a real one
  (`claimed`).
- **When evidence must live in a table a gate reads, acknowledge it — never
  delete it, and give the acknowledgement a control that refuses a FALL.**
  0583 put the 20 escapes in `known_escapes` so the witness can say *"22 known,
  0 new"*, and raises if the known count ever drops, because the one outcome
  that must never be produced is evidence removed rather than recorded. A gate
  red by design is one somebody starts skipping.


- **A DUTY THAT SUCCEEDS AT SAYING IT FAILED IS INVISIBLE TO EVERY FAILURE
  MECHANISM THE OFFICE HAS.** Grant's Google token was revoked on 15 September
  and `google.read_mail` and `google.read_calendar` each told him so EVERY HOUR
  for four days — **194 deliveries, one distinct body**. `check:chatter`'s
  ceiling is a hundred a day per kind and this peaked near 36;
  `app.recurring_failures` and `app.notice`'s `failure_repeats` branch both read
  FAILED jobs, and these jobs COMPLETED. A gap between two correct halves.
  `app.say_once` (0584) is asked at the one place `jobs.announce` is written.
- **A model rewording an unchanged fact defeats every text-based witness.**
  `office.notion_sync` sent 137 messages with **128 distinct bodies**, saying one
  thing — the count was 60 for 72 consecutive runs, then 57 for 51. Counting
  distinct bodies says "barely any repetition"; counting the NUMBER INSIDE them
  says it never moved. When a duty's announcement passes through `sayAs`, dedupe
  on what it is ABOUT, never on what it says.
- **"Do not repeat" is the wrong rule; "say it when it changes, and once a day
  when it does not" is the right one.** He should still be told daily that his
  mail has been unreadable for a week. Once an hour is not telling him, it is
  teaching him to swipe the notification away — the same cost as a health
  reading that cries wolf.
- **A dedupe rule must fail OPEN, never turn silence into speech, and never key
  more coarsely than the thing it is about.** `?.say !== false` so an empty row
  speaks; it runs under `if (announce)` so a handler with nothing to say is
  untouched; and 0585 keys on (kind, PROJECT) because `drive.watch` runs per
  project and two projects whose news reads identically would otherwise have had
  the second MUTED — losing real information, which is the expensive direction.
  A NULL in that key would never match `on conflict`, so the sentinel is
  `app.unnamed_project()`.
- **`max(created_at)` over ALL runs is not the last FAILURE — misread twice in
  one hour.** It made a handler fixed on 18 September look like it was still
  failing today, and a message burst that ended on the 18th look ongoing. Filter
  to the rows you are describing before reading a max, and say so when you got
  it wrong rather than building on it.


- **A READER'S COUNTERS AND ITS LIST CAN FILTER DIFFERENTLY, AND ONLY ONE OF
  THEM WILL BE RIGHT.** `app.hq_studio_lately` asked `not app.harness_job(...)`
  for `jobs_done` and `jobs_failed`, and filtered the FEED beneath them on
  `p.project_id is null or not p.is_fixture` — a fixture PROJECT, saying nothing
  about who acted. #45 sends any suite testing a fixture filter to a REAL
  project, so **73 of 125 items on his Recent activity panel were suites**, six
  of them on the first page. The clean numbers sat directly above the dirty
  list. When one function answers a question twice, diff the two predicates.
- **Filtering the noise is what lets you read what is left.** With the suites
  gone, `app.action_in_words` was visibly composing `'a ' || noun`, so
  `autonomy.changed` — 441 events, and #15 made that dial something Grant sets —
  reads *"changed a autonomy"*. It had been invisible because every vowel row on
  the panel belonged to `verify:pursues`. Fix an article by SOUND, never by
  listing the nouns: a list is wrong the first time the office grows an
  `action_type` nobody wrote down.


- **A SWEEP AT THE END CANNOT PROTECT A SURFACE THAT READS CONTINUOUSLY.**
  `verify:notice` writes a signature its positive control needs the reader to
  SURFACE — carrying a real job id, because #45 says a control the filter would
  reject proves nothing — and swept it afterwards, with a crash handler and a
  comment recording that such a row had once reached Grant's briefing. It
  happened again: his 04:00 briefing on 23 September named
  `noticeproof.mu6wxsku`. A sweep only NARROWS the window and a duty fires
  inside it. Write and assert inside ONE transaction that never commits — the
  reader sees its own transaction's writes, so the control is just as strong and
  the window is zero.
- **"I cannot check this" is not "this is real" — and the writer and the reader
  had the same hole.** `app.recurring_failures` guarded with
  `f.last_job_id is null OR not app.harness_job(...)`, and `app.failure_seen`
  with `if p_job_id is not null and app.harness_job(...)`, so a signature with
  no job was neither refused going in nor filtered coming out and was reported
  to Grant as a recurring failure of his. 0304's asymmetry with the sign
  reversed. Before excluding the unattributable, check who writes it: the only
  product caller is `worker.ts` and it always passes the job.


- **A HEURISTIC THAT RETURNS OUTRIGHT IS A PRECEDENCE DECISION, AND IT BEAT THE
  EXPLICIT VERB.** `pageRequest` asked "is this message essentially just a
  link?" BEFORE "did he ask for it to be read?", and returned `bare` from the
  first — so `Read https://… for me` (9 letters of framing),
  `Take a look at https://…` (11) and `Open https://…` (4) were all filed to the
  notebook instead of opened, although `read`, `open` and `take a look at` were
  already in the verb list. The shortest phrasings are the commonest, so the
  gate fired on precisely the sentences it should have deferred to. When two
  tests can claim one sentence, state the precedence deliberately — and confine
  the override to the branch that needs it: letting the verb win in the LONG
  branch too would turn `<link> check this out later` into a gather, because a
  bare `check` is in that list.


- **A SAFE FAILURE MODE IS NOT THE SAME AS NO REGRESSION.** 0589 gave
  `app.say_once` a third parameter and the first version of the worker sent
  EVERY call through the new arity, with a catch that fails open. On a database
  that has 0584 and not 0589 that means every call throws, every catch fires,
  and 0584's dedupe is silently OFF — worse than before the change, arrived at
  through a guard that is individually correct. The arity a caller asks for must
  follow what it is asking, not what is newest. Ask what DEPLOYING would do on
  the database as it is now, not on the one the migration assumes.
- **A migration can be blocked by another branch's UNCOMMITTED file, and there
  is no honest way round it.** `npm run migrate` refuses globally on one
  `checksum/missing`, the body is unrecoverable (`app.schema_migrations` holds
  name and checksum only), and a reconstructed file fails `checksum/modified` —
  the guard working in both directions. Write the migration, commit it pending,
  make the code non-regressive without it, and say so; do not hand-write the
  bookkeeping row.
- **My own regression test was a wording lock on my own code — the seventh
  instance, and the first where I wrote both halves.** The pass-29 test asserted
  the literal expression `?.say !== false` and the exact `say_once(...)` call
  text, so a correct refactor one pass later turned it red. Assert the
  properties — the body is passed, the topic is passed, the arity follows the
  question, it fails open — not the characters that currently express them.


- **"NO LONGER UNREACHED" HAS TWO CAUSES AND THE REPORT NAMED ONE.**
  `check:callers` said four `public.sign_in_*` baseline entries were *"now
  reachable"*. Nothing called them: not the repository, not `pg_proc`, not the
  gateway. **They had been DROPPED** — on a shared database another branch
  removes what it created. Disbelieving one wrong word cost six queries. The
  check now distinguishes *something calls it now* from *NO LONGER EXISTS; it
  was dropped, not wired*, and both branches are proved. Third instrument in
  this file to name the wrong cause, after "12 of 6" and `check:templates`
  blaming a backtick for a duplicate `const`.
- **Every filter can hide something real, so audit a session's filters
  together.** A run that fixes leakage fix by fix ends up having narrowed five
  readers, and each one's expensive direction is the same: hiding HIS work, not
  showing a suite's. Check them as a set — widened predicate, filtered feed,
  narrowed failure reader, deduped announcements — with one question each: what
  of his does this no longer show?


- **A GATE CHECKED ONLY AGAINST THE SENTENCE THAT CREATED IT IS CHECKED AGAINST
  ONE SENTENCE.** `deniesWhatItHolds` exists for #342 — the office denying his
  own project list — and its subject alternation was
  `there are | we have | i have`. **Not `you have`**, which is how the office
  actually talks about HIS holdings, so *"You have no open projects."* — the
  canonical phrasing of the defect it guards — was the one form that slipped
  through, while *"There are no projects on record."* was caught. Every earlier
  check had reused the wording from the original report. Probe a gate with the
  phrasings a real answer would use, including the ones you expect to pass.
- **And the negated auxiliary takes a different quantifier.**
  `you have NO projects` and `you do not have ANY projects` need two patterns;
  putting `do not have` into the alternation that requires `no|none|not any`
  leaves the commoner spoken form missing. I wrote that bug into the fix for
  this bug and the probe caught it in one run — which is the argument for
  driving a detector over a table of sentences rather than reading it.


- **THE COHERENCE GATES WERE WRITTEN IN THE OFFICE'S VOICE AND THE SECOND
  PERSON FELL OUT OF ALL OF THEM.** `deniesWhatItHolds` matched
  `there are | we have | i have` and not `you have` (#361); one gate over,
  `assertsRecordsUnseen`'s container shape matched `the diary is empty` and not
  `your diary is empty` (#362). Both are the phrasing the office ACTUALLY uses
  when talking to Grant about his own things, so in each case the one form that
  slipped was the canonical one. Two instances an hour apart is a class: widen
  the determiner and the subject together, and when you fix one of these, grep
  the neighbouring gates for the same pronoun assumption before the third
  instance arrives.


- **THE WORST CREDENTIAL DECIDED THE WHOLE SERVICE, AND THE OFFICE NOW BELIEVES
  IT CANNOT DO WHAT IT IS DOING.** `app.capability_index_core` takes one
  `connection_health` row per service, ordered `when 'dead' then 0`. Slack has
  two credentials doing different jobs — `bot token` (**ok**, posts) and
  `config token (12h)` (**dead**, renews) — so the service reads
  `reachable = false` while **35 Slack messages went out in six hours**. That
  index builds EVERY agent's prompt, so all eight are told they cannot post,
  and `capabilityLies` cannot catch the false denial because given the index it
  is true. 0298 with the sign reversed, and this file already says which way is
  expensive: a false NO produces nothing at all. **Before letting one
  credential's state speak for a service, ask which capability that credential
  actually serves** — and check the belief against what the office has
  DELIVERED, which is the one source that cannot be argued with.


- **ONE RECOGNISER DEFERRED TO ANOTHER AND THE OTHER DECLINED, SO THE
  INSTRUCTION WENT NOWHERE.** `callsItOff` refuses `stop` + a gerund on purpose
  — its comment says *"a rule about how the office behaves… 'stop sending me
  updates'"* — because a false call-off destroys work in flight. It hands the
  sentence to the rule path. `readTeaching` needs a standing marker (`from now
  on`, `always`, `never`), so *"Stop sending me updates."* is stored by
  NOTHING, and `remember()` is gated on it so there is no second route. The
  office complies that turn, because the sentence is in the prompt, and forgets
  by the next — which is exactly what he complained about twice in September.
  **When a recogniser declines by deferring, open the thing it defers to and
  check it accepts.**
- **And the obvious widening is worse than the gap.** `stop\s+\w+ing` covers
  *"stop using bullet points"* (a rule) and *"stop working on the venue
  report"* (calling off work) identically, so teaching a bare imperative would
  store the second as a standing rule — and 0567 records what a wrongly-stored
  rule costs: eight days in every prompt at 0.95 confidence, permanent, because
  `public.lessons` refuses UPDATE.


- **THE WORST CREDENTIAL SPOKE FOR THE SERVICE, AND ONE OF THEM WAS ONLY THERE
  TO RENEW THE OTHER.** `app.capability_index_core` takes one
  `connection_health` row per service ordered worst-state-first, so Slack's
  **config token** — dead since 18 September, and only ever used to administer
  the app — made the service read `reachable = false` in every agent's prompt
  on every turn while the **bot token** carried 268 messages. Nothing
  downstream could catch it: `capabilityLies` asks whether an answer
  contradicts the index, so given the index the denial was TRUE. 0298 with the
  sign reversed, and this file already says which direction is expensive.
  **Worst-state-wins is correct and it is correct somewhere else**:
  `app.project_connections` says so in its own comment, and a surface
  REPORTING health to Grant must keep showing him the dead credential. Only
  the reader that tells an AGENT what it can DO needed the other question —
  not "is anything wrong with this service" but "is the credential the office
  acts through alive". Two things make the fix safe rather than a blanket
  "ignore dead credentials": `purpose` defaults to `'acts'`, so nothing
  becomes reachable by being reclassified, and the preference is an ORDER BY
  rather than a WHERE, so a service whose every credential is `maintains`
  still surfaces its worst row instead of matching nothing and falling through
  `coalesce(state, 'ok')` — the found-nothing shape, on the one surface where
  it would read as success.
- **Check a belief against what the office has DELIVERED, because every other
  witness agreed with the thing that was wrong.** `check:believes` reads the
  capability index against `public.deliveries`, and fires in one direction
  only: delivery evidence can prove a capability exists and can never prove
  one absent, so a quiet day is never a finding. 0304's asymmetry, sixth
  application.

- **A FINDING CAN BE ACCURATE AND ITS OBVIOUS FIX A REGRESSION — measure the
  exposure before widening anything.** #364 correctly observed that *"Stop
  sending me updates."* is stored by NOTHING. In **1,438 real turns, zero open
  with "stop"**, and the five conduct-shaped sentences his traffic does
  contain are every one scoped to the turn or a question. Widening `STANDING`
  to admit a bare imperative would have stored *"actually do not contact
  anyone at all on this"* as a PERMANENT rule, and `public.lessons` refuses
  UPDATE. The structural observation was right and acting on it would have
  disabled outreach for ever. What was missing was a CHECK, not recognition:
  the distinction lived in a comment, and a comment claiming a property is
  worth nothing without one — so the pin uses HIS real words, and landing the
  proposed widening turns 5 of 14 red.
- **And the issue's own premise did not survive one query.** #364 cited his
  September complaints as evidence; *"You're still not respecting my
  request…"* is the bullet-points complaint, whose cause was `guidanceFor`
  dropping `learned_by` — already fixed, and never about a sentence nothing
  stored. **A filed issue's stated cause is a claim about the product**, the
  same as a baselined reason, and this file has now recorded three false ones.
- **A FILTER IS PART OF THE ASSERTION, and the wrong one made me publish five
  of a suite's sentences as Grant's.** `app.harness_label(dedupe_key)` anchors
  on the dedupe key's NAMESPACE; `verify:mytasks` writes
  `teamhq:my_tasks:<run>` there while the JOB it creates is
  `teamhq:verify-mytasks-<run>`, so the label predicate says real and
  `app.harness_job` — which reads four signals including that
  `requested_by` — says harness. The corpus was **1,438 turns by the weak
  filter and 182 by the canonical one**, and every sentence I had quoted as
  his was a suite's. The product does NOT make this mistake: every SQL reader
  of `inbound_commands` was checked and only `harness_job` uses either, the
  rest inheriting the job's attribution. **`app.harness_job` is the canonical
  predicate; `harness_label` answers a narrower question and is not a
  substitute for it.** A finding filtered with the weaker of two predicates is
  a finding about the filter — and the tell was a random run token sitting in
  the middle of a sentence I was about to quote.


- **A CALLER'S PRE-CHECK WAS STRICTER THAN THE CALLEE'S OWN TOLERANCE, SO THE
  CASE THE CALLEE WAS WRITTEN FOR COULD NEVER REACH IT.**
  `app.answer_generation_approval` handles a missing `approval_next` in its own
  body — *"notebook.generate when the job did not say, which is every approval
  created before this migration"* — and `app.hq_answer_blocker` routes to it
  only `if v_next is not null`. So three of the four questions open on Grant's
  dashboard were notebook generation approvals where pressing **Go ahead**
  returned `ok=true, state=resolved, started=0`: the office says yes, marks the
  question answered, and queues nothing. Fifteen days live, on the mechanism
  his *"always check before making any destructive action"* depends on, and
  worse than a refusal because the answer was accepted. **0282/0293's shape,
  fourth instance** — when you write a tolerant default in a function, grep for
  the guard that decides whether anything calls it.
- **Fix it in the WRITER when the router's alternatives are both unsafe.**
  `app.request_generation_approval` never recorded what answering performs.
  Widening the router by JOB KIND would let a plan step's approval — raised by
  `perform.ts` on a PAUSED job and answered by RESUMING it — be turned into a
  duplicate generation; widening it by OPTION TEXT is #130's parsing defect on
  a path that enqueues work. The writer already knows what it is raising.
- **"An offer may only promise what the press can perform" appears NINE times
  in this file and was never a check until #366.** Nine controls, nine
  hand-drives months after each shipped. `npm run check:answerable` asks it
  structurally: a question must RESUME (its job is still parked) or START
  (`blockers.on_answer`, or the job's `approval_next`) — neither means the
  answer has nowhere to go, and no English is read, because deciding it from
  the option text is the defect it guards. **When a lesson in this file reaches
  three instances, it wants a check, not a fourth paragraph.**
- **A `sed -n '6p'` over a query result grabs the table separator, and the
  update it feeds then errors and changes nothing.** The check passed, exit 0,
  and that zero was the SABOTAGE failing rather than the check working —
  seventh instance of that class. Extract a uuid with a pattern
  (`grep -oE '[0-9a-f]{8}-...'`), never by line number.
- **A `grep` over a command's output matches the ECHOED SQL as well as the
  result.** Verifying a restore with `grep -oE 'GONE|notebook.generate'`
  matched the literal `'GONE'` inside `coalesce(..., 'GONE')` in the echoed
  query, so a restore that had worked read as a failure and nearly sent me to
  repair live data that was fine. Verify with the canonical READER — here
  `check:answerable` itself — not with a grep over a shell transcript.

- **The test browser cannot reach the internet, and it is not a policy — it is
  an EMPTY trust store.** Outbound HTTPS goes through an agent proxy that
  re-terminates TLS. Node, curl and git are configured for its CA by the
  environment; **Chromium is not.** It reads the NSS database at
  `$HOME/.pki/nssdb`, which exists and holds nothing (`nssPublic`: 0 rows), so
  every browser request to a public origin dies `ERR_CERT_AUTHORITY_INVALID`
  while the identical request from Node succeeds — and a whole class of
  verification gets written up as "cannot be checked here" when it can. It was
  reported that way for the life of a branch. `npm run trust:proxy-ca` fixes it
  in one idempotent step, and **verification stays on**: after it,
  `expired.badssl.com`, `self-signed.badssl.com` and `wrong.host.badssl.com`
  are all still refused. Never reach for `--ignore-certificate-errors` or
  `ignoreHTTPSErrors`: a browser that accepts anything is not evidence of
  anything, which is the same argument as a security check that cries wolf.
  What this unlocks is the thing a server-side fetch can never do — **CORS from
  the real deployed origin**, the defect that left the voice call dead for
  weeks while every probe passed.

- **Twenty-nine suites were passing because the browser could not reach the
  office.** Every one of them fakes a writer with
  `localStorage.setItem('hq.token', 'some-made-up-string')` and then asserts on
  controls that are only drawn for a writer. That worked for exactly one
  reason: the sandbox Chromium could not reach `*.supabase.co`, so the page's
  first read failed as a NETWORK error and the credential stayed in storage.
  The moment `npm run trust:proxy-ca` let the browser through, the office did
  the right thing — it refused a token it never issued with a 401 — and
  `office.js` did the right thing, clearing a refused credential. The page went
  read-only **inside 600ms** and every writer-only control vanished.
  `verify:basecamp-look` started failing against a product that was working
  perfectly, and the instinct was to blame the merge it happened to appear in.
  **A test that depends on a failure mode of the environment is a test that
  will invert the day the environment is fixed.** Where a suite needs a writer,
  give it the vault token so the office accepts it; where it needs an
  unreachable office, say so with an explicit route abort rather than relying
  on the network being broken.
- **A section the gateway routes to needs a `public` wrapper, and neither
  suite that covers it was looking there.** `hq-api?section=pulse` returned
  **502 on every dashboard page load** — `app.hq_pulse` exists, `public.hq_pulse`
  never did, and PostgREST only exposes `public`. `verify:pulse` passed 11/11
  by calling `app.hq_pulse()` in SQL, which is `verify:search`'s recorded
  defect exactly; `verify:wrappers` passed 43/43 because `hq_pulse` was not on
  its hardcoded list. `npm run check:gateway-wrappers` asks it as a property
  instead — the `fn:` entries in the gateway's own SECTIONS and ACTIONS maps
  ARE the list a browser can reach — and it found the one bad entry among 147.
  Only a browser at the real deployed origin ever saw it (#340).

- **"Not known to be harness" is not "real", and a guard that asks the first
  question lets the unknown through.** 0601 made every message name its job and
  asked `app.harness_job` of it — a predicate ending `coalesce(…, false)`. So a
  turn through a production door whose key no adapter produces
  (`telegram:artifact_demo:…`, which reached Grant on 17 September) read as
  his, and so did a root job no office function creates. `app.job_origin`
  (0603) is the other question, answered positively from what each adapter and
  each job-creating function actually writes; both boundaries ask
  `app.may_act_outside`. When an adapter changes its key, change
  `app.adapter_key_ok` in the same commit, or its real traffic goes quiet.
- **A fixture that models real traffic must be real by the product's own
  definition, or the control passes for the wrong reason.** Every "real
  Telegram" control in the #378 proofs used the four-part key the adapter
  stopped writing on 7 September; three approval proofs modelled Grant's job as
  a hand-inserted root; a Slack timestamp had three decimals. All green, all
  vacuous — the guard simply could not tell. Build fixtures from the adapter
  functions (`scripts/isolated/real-telegram.ts`, `legit-origins.ts`).


- **A valid signature proves the credential, not the person.** 0603 trusts a
  turn whose key the production adapter wrote, and a suite posting a correctly
  signed update to the deployed webhook gets exactly that key.
  `verify:latency` posted AS Grant from his own chat and his own Slack user:
  29 messages to him, the office group and the lobby, 9 to 21 September, still
  read as his a week later, invisible to every witness. The gate-3 and
  `verify:telegram` "hello"s were relabelled harness only after the office had
  answered (21 more). Test intent inferred after acceptance is not
  containment. **Declare the conversation BEFORE knocking**
  (`testOrigins(db, …)`, 0605): the door writes it synthetic, and the database
  refuses to declare anything real (#381).
- **The Telegram webhook records every chat it hears from under Grant's
  subject, before deciding anything,** and `telegram_chat_for` pages the
  newest deliverable one. A fixture chat recorded that way is, until its row
  is deleted, where his messages go. 0605 records a declared chat as not
  deliverable. And a proof's "real" Telegram turn must be recorded there, with
  `actor` set to the sender's numeric id as the adapter writes it, or it is
  not modelling Grant.
- **`String.replace` reads `$'` and `$&` in the REPLACEMENT string.** Splicing
  one SQL builder into another whose text contains regex `$` produced a syntax
  error at a quote forty lines away. Pass a function: `s.replace(x, () => y)`.

- **A test destination is only non-human if nobody is IN it.** `verify:slack`
  registered the channel it created as a test destination, and the
  provisioner had invited Grant into it on creation, so about seven suite
  messages landed in a room he was a member of. A `zz_` name is not what makes
  a room safe; its membership is. A fixture project's channel now invites
  nobody, and the suite asserts the membership Slack reports.
- **Deleting a test-destination registration in teardown deletes the reason
  the send was allowed.** The witness then correctly reported a legitimate
  send as a breach, because it reads registrations as they stand now.
  Registrations are retired, never deleted (0606), and "was it registered when
  the guard decided" is `app.test_destination_at`.

- **The build session's proxy can hand the browser a response Vercel never
  sent.** During the #382 acceptance a stylesheet was refused as
  `text/plain`, and scripts arrived as 502s so the page never started. The
  failing responses had no `x-vercel-id` and no `server` header, and their
  bodies were the real file contents: the outbound proxy had cut off a
  parallel transfer and relabelled it. Vercel stamps `x-vercel-id` on every
  response. So before reporting a live MIME or 5xx failure as a product
  defect, read that header. With none present it is the sandbox, and one curl
  or one reload that comes back clean confirms it.

- **A guard placed at each writer is a guard for the writers somebody remembered.** The forwarded-content fix closed
  links, rules and personal tasks one by one, then `entitled` for ten more readers - and an independent review drove
  the real handler and found a forwarded "mark the call Kevin one done" ticking a task, "cancel it" cancelling one and
  "add a task to wire the deposit" creating one, because those writers read through `firstOf`/`firstOfHis`, a door the
  fix never named. The repair is at the DOOR the writers share (both closures are silent for a forwarded turn), proven by
  `scripts/isolated/forwarded-writers.ts` driving every writer with a typed control. Ask what every reader has in
  common before guarding any one of them.
- **A rule's body was the first sentence of the message, whatever sentence carried the marker.** "Remind me tomorrow to
  call Kevin. From now on give me the conclusion first." stored "Remind me tomorrow to call Kevin." as a permanent
  standing rule - append-only, in every prompt - and a question mark at the END of a message silenced a rule earlier in
  it. Both decided about the rule from text that was not the rule. Found by sending a three-clause message through the
  real handler, which is the only way mixed intents can be found.
- **A test that names the gate is satisfied by the import line.** `every-external-kind-is-gated-or-named` first decided
  "gated" by a regex for `approval-gate`, which `plan.ts` matches on its import alone; replacing every call with
  `{ ok: true }` stayed green. A gate is a call whose answer is consumed (`const x = await mayStart(...)` then
  `if (!x.ok)`), so that is what it asserts. #268's superstring, in its commonest form.
- **An allow-list that forbids names passes the function that does the forbidden thing under a friendlier name.**
  `output_import` was in the office key's allow-list while `import_output` approves a document inline - the act
  `document_approve` refuses the key for. The architecture test matched `approve|decline|...` in the ACTION name.
  `service-decides-nothing` follows the calls in the catalog instead and found it in one run and nothing else.
- **A child that inherits its asker's marker is asked about as the asker.** An approval creates the job it approves with a
  copy of the asking job's config, including `approval_next`; a later STEP question on that job was then answered as the
  plan's own approval and a yes was recorded as a decline. Every proof built its step questions on empty-config fixtures.
  Build the fixture from the function that creates the real thing.
- **A control the notice tells him to press has to work on the state the notice describes.** The parked-turn notice said
  "stop this job"; `request_stop` only stamped a flag that a running handler reads, so on a paused job it did nothing.
- **A declared test origin is not exempt from the webhook's own side effects.** A declared voice note spent a runner
  dispatch (Actions minutes) and could send a refusal through a real bot; the containment proofs all looked at
  DELIVERIES. The edge emulator refuses and records every URL that is not the replica, which is how this was made an
  observation (`telegram-voice-test-origin`).
- **A suite that is not in the gate went red and nobody knew.** `verify:approval` failed 6 of 30 against the current
  matrix for two independent reasons (a hand-built "Grant" job whose origin is unknown since 0603, and a level-1 fixture
  the matrix now lets through unasked). Nothing ran it. A hand-built fixture asserts the rule it was written under.

- **A list of dangerous phrasings is the wrong shape for a boundary whose rule is "unknown is not benign".** The first
  learning gate offered a rule only if four patterns recognised authority in it, so "handle refunds yourselves" and
  "keep my accountant informed" were stored while "paste the image URLs into the reply" (his own rule) was offered
  because "reply" is a verb. The gate is the inverse now: a teaching is stored on its own only when it is POSITIVELY
  recognised as presentation or as addressed to him. An independent reviewer found it in one pass.
- **A tool level decides what the most permissive dial does.** `slack.channel` at level 2 made an unprompted sweep create
  a permanent channel at dial Act, and its announcement said "because you said yes". Level 3 is the only level a dial
  can never turn into proceed.
- **A yes minted by an act must be withdrawn by the opposite act, at the table, not the page.** Detaching a Notion
  database left its standing yes live; a trigger on `project_attachments` now covers every route.
- **A heuristic that picks a destination is not Grant choosing it.** `office.notion_adopt` chooses a database by its
  title; minting a standing write yes there made any shared database called "Tasks" a target. Connect is his act.
- **A budget on raising questions must not be a budget on honouring answers.** `MAX_DELETE_QUESTIONS_PER_ROUND` returned
  false before looking for an approval already given.
- **A rollback comment that says the code falls back is a claim.** Three said so and none was true; a database-only
  rollback of 0644 broke every answering turn. The callers degrade now and the notes say to roll the worker back first.
- **Forty-three public tables had row security off and default grants to the anon key**, and the anon key read
  `standing_authorizations`. #384 covered functions only. 0642 revokes tables and default privileges;
  `check:anon-exposure` asserts both. Whether those tables also want row policies is a multi-user question.

- **A DEFAULT IS AN IDENTITY.** `office_members.owner_key` defaulted to `'grant'`, so a member added by the obvious
  one-line insert spoke as Grant, decided his approvals and - once an operator list keyed on that name existed - WAS the
  operator. No code had to be wrong for that to be true. 47 functions still carry a `default 'grant'` person; a new reach
  from the machine key to one fails `check:machine-key` until it is pinned with a reason (0652, multi-user P1).
- **A source-reading test that asserts a NAME stayed green when the gate was removed.** `voice-token` was gated by
  `resolveSpeaker(bearerOf(request)` and the first test looked for that text and for the 401 line; replacing the condition
  with `false` left it green. What discriminated was loading the real handler under a stubbed `Deno` and counting the
  fetches a stranger caused (zero). `tests/auth/speaker.test.ts`.
- **A negative that refuses for the wrong reason.** The first `google-oauth` callback negatives passed because the
  function refused with "No client id yet" before it looked at a state. Each now asserts the SENTENCE it was refused with,
  and the suite configures the client id so the state is the only thing left to refuse.
- **A proof that alters the tables it runs on must refuse a shared database.** `ownership-composite-fk.ts` takes a
  database argument; pointed at the shared replica it left nine tables changed and the replica had to be rebuilt. It now
  refuses anything not named `fk_spike*`.
- **Retire the old door AFTER its consumers move, in a separate migration.** 0648 added the resolver; 0649 removed
  `public.vault_secret`, applied only after hq-api, google-oauth and the worker were redeployed to stop calling it.
- **A credential scope that must reach handlers built once around a database handle cannot ride on the handle.** Most
  handlers ignore the `db` that `handle()` is given, so the job a credential read is for travels in an
  `AsyncLocalStorage` (`src/credentials/deployment.ts`). No scope means the worker acting for the deployment; that
  argument exists only in `app`, which PostgREST does not expose.

- **A GUARD THAT CALLS A FUNCTION ITS WRITER CANNOT SEE FAILS FOR EXACTLY THE WRITERS IT EXISTS TO CONSTRAIN.** The P2
  compatibility bridge called `app.bridge_office` as the invoker; `service_role` has no usage on schema `app`, so the
  Telegram webhook (which writes `inbound_commands` through PostgREST AS service_role) answered 503 to every update for
  7 min 47 s (0664). The attack suite had hidden it by granting its attackers usage on `app`. **Model the writer with the
  privileges production gives it, assert with a positive control that it cannot reach what it cannot reach, and run a guard
  as its owner.** Found by the first live suite that touched the webhook - not by 96 green checks.
- **`ALTER TABLE` refuses a table with pending trigger events (`55006`).** An UPDATE that fires a deferred constraint trigger
  (an active project must have an attachment) queues events for commit; an `ALTER TABLE` later in the same transaction fails.
  `SET CONSTRAINTS ALL IMMEDIATE` fires them first. Found only by running the WHOLE chain against production in one transaction
  that ends in a deliberate exception - a rehearsal that stops at the report never reaches the DDL after it.
- **A rolled-back dry run is not free: `ALTER TABLE` takes `ACCESS EXCLUSIVE` while it lives.** Mine deadlocked a live suite
  (`verify:history`, `40P01`) and, twice, the live worker, and a gate that ran alongside it went red on five entries that pass
  alone. Never rehearse a schema change while the gate runs; classify a red by rerunning it on a clean worktree, not by guessing.
- **`office_id = Grant` does not mean real.** A harness row linked by a database key to his project is in his office (5,821,
  counted in `office_backfill_report`), because a composite key cannot say "a test row inside this project". Every reader that
  excludes harness traffic still has to.
- **A meter finds what a test cannot.** `office_bridge_use` showed one table relying on the bridge, and that table was binding
  chats a suite had declared test origins to the person (0666). A compatibility shim without a counter is a leak with a name.
- **Raising a question also files a to-do on his personal list**, so a suite that raises fixture blockers leaves to-dos behind
  (ten, twice - the same ten the P1 closure cleared). Each suite now sweeps that class in its own teardown.

---

## Visual standard

`docs/spec/frontend-build-prompt-2026-09-10.md` §§14, 14A, 17–20 are binding.
The short version:

- **Never judge visual work from source.** Run it, capture it at desktop and
  phone, look at it, critique it, fix it, capture again. `verify:hq`,
  `verify:ui` and `verify:talk` already drive real Chromium at three sizes.
- **The WOW gate:** *if all the data were fake, would this still feel unusually
  beautiful, sophisticated, tactile and memorable?* "Clean" or "professional"
  is a **fail**.
- **After two failed visual iterations, stop tweaking** and reconsider the
  composition, interaction model or technology.
- **No generic-AI UI:** sidebar-plus-uniform-card-grid, interchangeable rounded
  rectangles, arbitrary gradients, glassmorphism everywhere, decorative charts.
- Type floor **12px**, touch targets **44px**, and inputs **≥16px** or iOS
  Safari zooms the page on focus. `verify:ui` enforces these.
- Grant on the corporate palette: *"Don't use the corporate colors. Use a
  different color scheme."* Two schemes, light and dark.

## Scripting the GitHub API

Build the JSON body **in a file**, never inline in a shell command:

```bash
cat > /tmp/body.md <<'EOF'
...markdown, backticks and all...
EOF
python3 -c "import json; print(json.dumps({'body': open('/tmp/body.md').read()}))" > /tmp/b.json
curl -X POST ... -d @/tmp/b.json
```

Inline `python3 -c "..."` inside double quotes lets the shell expand backticks
first: an Issue body containing `npm run shots` had that command **executed**
and its output pasted into the Issue, while every backticked path vanished.
Issue #22 was filed twice for this reason.

## When Grant sends you a pile of ideas

He will. He thinks out loud, often into a voice note, often while several other
things are already in flight — and he said what he wants done with it:

> *"The user should be able to voice ideas throughout the day, provide them to
> the development agent, and trust that they have been captured, organized and
> preserved without automatically destabilizing the current build."*

**An idea dump is a capture task, not a build task.** Unless he says otherwise,
the deliverable is Issues, not code.

The order, which is his:

1. **Understand the intent** behind each idea, not just the words.
2. **Inspect what already exists** — the schema, the open Issues, the ADRs.
   Most "new" ideas turn out to be an existing abstraction he has not seen the
   name of. The capability-expansion brief of 2026-09-12 asked for ten systems
   and eight of them were already in the schema (#169 has the table).
3. **Consolidate rather than duplicate.** Extend an open Issue with a comment
   where one already covers it. A second Issue for the same thing is how a
   backlog stops being readable.
4. **Cross-reference** in both directions.
5. **Defer implementation** where the current work has not reached a stable
   point. Say so in the Issue rather than starting.
6. **Preserve enough context** that a future agent can act on it without this
   conversation. That is the whole point — the repository is the durable
   memory, and a compaction has already destroyed one specification.

And the rule that outranks the rest of it:

> *"Do not allow these ideas to derail, duplicate, or destabilize work already
> underway."*

Before inventing a noun — **Skill, Capability, Tool, Plugin, Action,
Integration, Agent, Workflow, Task, Evaluator** — check whether this office
already has one. It has all ten. #169 lists where each one lives.

---

## Documentation you must keep current

When you finish a piece of work: update the Issue (or close it), update
`docs/HANDOFF.md` if the state of the product changed, and write an ADR in
`docs/adr/` if you made a decision a future agent could accidentally reverse.

A decision recorded only in a commit message is a decision that will be
re-litigated.

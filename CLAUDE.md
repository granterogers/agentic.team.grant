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
| **Which frontend** | **`web/studio` is the product**, served at the root. `web/hq/index.html` is deleted — every write action, section and the voice call moved across (**ADR-0019**, Issue #68). `verify:design` fails if a second frontend reappears. |

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

`npm run migrate` applies plain SQL from `migrations/`. **409 applied.**

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
npm run check:icons      # every project-mark default names a mark the page can draw (#221)
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

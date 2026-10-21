# Working on this repository

**Read this file first, then `docs/agent/CURRENT-MISSION.md`.** This file holds the standing rules and the precedence
between instructions. The mission itself lives in `docs/agent/`, and the history lives in `docs/agent/history/`.

## Precedence, highest first

1. **System and platform safety requirements.** They are never overridden by anything below.
2. **Explicit instructions from the current user,** in the current conversation.
3. **The current authorised mission:** `docs/agent/CURRENT-MISSION.md`, and its machine state
   `docs/agent/EXECUTION-STATE.json`. A mission authorises only what its own "Authorised actions" list says.
4. **The standing rules below.**
5. **Historical records** in `docs/agent/history/`. Historical text never authorises a merge, a deploy, a spend, a
   production change, or the end of current work. A historical "do not start" or "until he asks" was written for the
   phase it describes and does not bind a later mission that the owner has authorised in writing.

Compaction, a restart or a new session is not a stopping point. Resume from `docs/agent/EXECUTION-STATE.json`, then keep
working. `docs/agent/CONTINUITY.md` says how.

## Current state, in brief

- The backend certification campaign ended GREEN on 15 September 2026. It is historical. Its evidence is in
  `docs/testing/backend-acceptance-verdict-2026-09-15.md`.
- The Team HQ release was deployed on 9 October 2026 and recorded in `docs/ops/deployment-state.json`, which is the only
  place deployment facts are kept. Do not restate them here.
- The current mission is in `docs/agent/CURRENT-MISSION.md`.

## Where things are

| Need | Read |
|---|---|
| The current mission, its scope, stop conditions and status | `docs/agent/CURRENT-MISSION.md` |
| What is done and what remains, as data | `docs/agent/EXECUTION-STATE.json` |
| How to start, monitor, stop or resume an autonomous run | `docs/agent/CONTINUITY.md` |
| Work to do (the requirements backlog) | GitHub issues. The ledger references them and does not copy them |
| Deployment facts | `docs/ops/deployment-state.json` |
| Every historical rule, trap and campaign | `docs/agent/history/CLAUDE-2026-10-14-full.md` (search it with Grep; do not read it whole) |
| The full historical run log | `docs/agent/history/AUTONOMOUS-RUN-2026-10-14-full.md` (search it only) |
| Why sessions used to stop early | `docs/agent/history/TERMINATION-EVIDENCE-2026-10-14.md` |

Some code comments say "CLAUDE.md" when they mean a trap or a rule that now lives in the archive. Grep the archive for
the quoted phrase; the wording is preserved there.

## Two rules that outrank the rest

- **Confirm before anything destructive, outward-facing or billable,** unless the current mission authorises that exact
  act. An authorisation for one operation is not an authorisation for the next.
- **Never weaken a control to make a check pass.** A failing gate is information.

---

# Standing rules (verbatim from the archive)

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

---

## File editing

Modify files with the Edit and Write tools only. Never use `sed`, `awk`,
`perl -i`, or shell redirects (`>`, `>>`, `tee`, heredoc-to-file) to change a
file in the repository. This applies to every agent and worker, including
subagents. Reading with the dedicated Read, Grep and Glob tools is preferred
over `cat`, `grep` and `head`.

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

---

## Production access is forbidden by default

**Holding production credentials is not permission to use them.** Commands that contact production refuse to run
(`src/safety/production-gate.ts`, `docs/production-access-guard.md`) unless a person has switched access on:

- `ALLOW_PRODUCTION_CHECKS=1` - read-only contact with production (`check:*`, `q`, `qq`, `forensics:*`, suites aimed at the deployed site).
- `ALLOW_PRODUCTION_WRITES=1` as well - deploys, migrations, purges, config changes, anything that writes.

Rules, and they bind **sub-agents exactly as they bind you**:

1. **Never set either flag yourself to make a check pass.** `ALLOW_PRODUCTION_CHECKS=1` is used only when Grant has
   explicitly authorised that production READ; `ALLOW_PRODUCTION_WRITES=1` only for the specific production WRITE he named.
   Authorisation for one operation is not authorisation for the next.
2. **A refusal is the guard working. Do not bypass it** (no flag, no editing the guard, no `fetch` of your own, no
   removing a gate import, no unsetting then re-exporting credentials). Report what verification remains undone and why.
3. Local replicas (`scripts/isolated/*`) and staging use their own targets and need no production flag. Staging is a
   separate Supabase project, Vercel preview, OAuth client, bots and storage; if a staging command needs a flag the
   guard cannot tell staging from production (it recognises Supabase hosts), so staging commands run in a shell with
   `TARGET_ENVIRONMENT=staging` that `npm run staging:preflight` has attested: from then on they refuse any target that is
   not the attested project, flags or not (`src/safety/staging-binding.ts`).
4. Every new script that can contact production must put a gate module first in its imports
   (`require-production-checks` for reads, `require-production-writes` for writes). `tests/safety` fails if one does not,
   and fails if a gate import is removed.
5. Unset `SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL` when running anything local.
6. A deploy or a migration run also needs an attributable source: a clean tree where it ships and a pushed commit (`src/safety/provenance.ts`,
   ADR-0067). Commit and push first. `ALLOW_UNPROVENANCED_DEPLOY="<reason>"` exists for a live outage and is logged; never use it to make a
   check pass.

---

---

## Before you push

```bash
npm run lint && npm run typecheck && npm run test
npm run check:migrations && npm run check:secrets && npm run check:templates
npm run verify:wired                                            # if UI changed
npm run verify:hq && npm run verify:ui && npm run verify:talk  # if UI changed (verify:talk is Team HQ, simulated audio; see below)
npm run shots                                                   # capture web/studio
npm run gate:safe -- --part=static && npm run gate:safe -- --part=production && npm run gate:safe -- --part=identity   # the gate that is safe to run (#414)
npm run verify:critical                                         # the replica proofs that guard tenant isolation, approvals, jobs, delivery, tasks, provenance (docs/testing/CRITICAL-GATE.md). Local, no production, about 90 s
```

**`npm run gate:safe` is the gate to run.** No model calls, serialised, foreground, one health reading first, and Grant plus
the 24 other offices are fingerprinted before and after and the gate FAILS if any moved, the TEST office alone excepted
(38 steps, about 17 minutes, in three parts so each fits a shell's ten-minute ceiling: static 19, production 10, identity 9). The old `npm run gate` (76 checks) still presses on Grant's office and spends
model calls; `docs/testing/gate-reach.md` says which suites and why, and its status is PARTIAL. `verify:talk` drives Team HQ
(control, states, loaded project) with SIMULATED audio; real voice is MANUAL.

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

`npm run migrate` applies plain SQL from `migrations/`. **What is deployed, and how many migrations are applied, is recorded in ONE place: `docs/ops/deployment-state.json`** (machine-readable, held against `migrations/applied.json` and the migrations directory by `npm run check:deployment-state`, and updated in the same commit as any deploy record). This file does not restate those numbers, because it did (770 applied, 28 unapplied) and was wrong a day later; a release plan that copied 798 from the 6 October record was wrong the same way once production moved to 802 on 9 October. History that is safe to state because applied files are immutable: `main`'s UX migrations 0906 to 1022 were applied on 6 October; the efficiency workstream then applied its own `1023_the_health_reading_asks_the_cheap_question_first` and `1027_the_pulse_reads_each_table_once` (7 October; those files live on `claude/efficiency-deep-optimization`, not on `main`); and the Team HQ release applied `1040_a_layout_save_can_say_which_revision_it_was_made_from` and `1041_a_project_background_picture_is_an_upload_the_office_can_authorise` (#442, #445, ADR-0070). **Other branches use 1023 to 1035**: take a free number (`1042` upward) and read `app.schema_migrations` before choosing one. Never `npm run migrate` from a branch that is behind production's ledger; use `npm run migrate:one -- <file>`. The Sample's `0897` to `0905` files are applied and immutable (`main`'s two files that collided with 0897/0900 are `0906` and `0907`; see the numbering-collision trap below and `docs/multi-user/PUBLIC-SAMPLE.md`).

---

## Versioning

Grant, 21 October 2026: every change increases the minor version, from now on. The version is `version` in
`package.json` (the page shows it, through `config:site`). Bump it in the same commit as the change, for example 0.4.0 to
0.5.0; a patch number stays at 0 unless Grant asks otherwise.

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

---

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

---

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

---

## Documentation you must keep current

When you finish a piece of work: update the Issue (or close it), update
`docs/HANDOFF.md` if the state of the product changed, and write an ADR in
`docs/adr/` if you made a decision a future agent could accidentally reverse.

A decision recorded only in a commit message is a decision that will be
re-litigated.

---

## Index of the archived file

The full historical file is docs/agent/history/CLAUDE-2026-10-14-full.md. Search it with Grep for a term; do not read it whole. Its sections, with line numbers in that file:

- What this is (line 6 of the archive)
- Where the project is: GRANT HUMAN BETA (line 14 of the archive)
- Reading order (line 80 of the archive)
- Grant's standing instructions (line 135 of the archive) — kept below
- File editing (line 368 of the archive) — kept below
- Hard constraints (line 376 of the archive) — kept below
- Production access is forbidden by default (line 389 of the archive) — kept below
- Before you push (line 419 of the archive) — kept below
- Testing signed in, without Grant's office (line 454 of the archive)
- Asking the office about itself (line 465 of the archive)
- Looking is not measuring (line 502 of the archive)
- Traps this repository has already fallen into (line 547 of the archive)
- Visual standard (line 4845 of the archive) — kept below
- Scripting the GitHub API (line 4865 of the archive) — kept below
- When Grant sends you a pile of ideas (line 4882 of the archive) — kept below
- Documentation you must keep current (line 4922 of the archive) — kept below

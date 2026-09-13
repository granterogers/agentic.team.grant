# Working on this repository

**Read this first.** It is the standing brief for any agent — or human — picking
this project up. Nothing here depends on a conversation you cannot see.

## What this is

An agentic AI office for Grant Rogers. Eight staff agents (Claire, Chief of
Staff; Tom, Strategy; Emma, Research; Daniel, Finance & Data; Marcus,
Operations; Ruby, Growth; Oliver, Communications; Grace, Quality & Risk) take
jobs from a Postgres queue, act on his real projects, and reach him through
Telegram, Slack, a voice call and a web dashboard.

## Reading order

| Document | Role |
|---|---|
| **this file** | how to work here — standing instructions and traps |
| [GitHub Issues](https://github.com/granterogers/agentic.team.grant/issues) | **all actionable work.** Milestones M0 → v1.0 |
| `docs/HANDOFF.md` | current state, summarised |
| `docs/integration-assessment-2026-09-10.md` | what exists, what is missing, what was decided |
| `docs/spec/frontend-build-prompt-2026-09-10.md` | ⭐ canonical frontend requirements — **v3, Autonomy** |
| `docs/spec/project-dashboard-ia-2026-09-10.md` | ⭐ canonical project IA — hierarchy, assets, the relational graph |
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

`npm run migrate` applies plain SQL from `migrations/`. **314 applied.**

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
- **A control that nothing looks up is a control nothing can have wired.**
  `verify:controls` presses things, costs minutes per route, and only covers
  what it can reach. `npm run verify:wired` walks seventeen screens, collects
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
- **Scratch scripts must live inside the repository** so `"type": "module"`
  applies; outside it, top-level `await` fails under CJS.

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

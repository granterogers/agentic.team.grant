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
| `docs/spec/frontend-build-prompt-2026-09-10.md` | ⭐ canonical frontend requirements |
| `AI_TEAM_HQ_MASTER_SPEC.md` | ⭐ canonical system requirements |
| `docs/adr/` | why each material decision was made |
| `docs/architecture.md` | vendor bindings |

**Issues are the backlog. This file and the handover are not.** If you discover
work and do not do it, open an Issue — never a TODO comment, never a note in
prose, never only a sentence to Grant.

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
| **Frontend stack** | No React, no Next.js, no bundler, no build step. Two hand-written HTML files on Vercel. Deliberate — ADR 0002, ADR 0011. Changing this needs an ADR and evidence, not preference. |

---

## Before you push

```bash
npm run lint && npm run typecheck && npm run test
npm run check:migrations && npm run check:secrets
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

`npm run migrate` applies plain SQL from `migrations/`. **169+ applied.**

---

## Traps this repository has already fallen into

Each of these cost real time. They are here so they cost it once.

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

## Documentation you must keep current

When you finish a piece of work: update the Issue (or close it), update
`docs/HANDOFF.md` if the state of the product changed, and write an ADR in
`docs/adr/` if you made a decision a future agent could accidentally reverse.

A decision recorded only in a commit message is a decision that will be
re-litigated.

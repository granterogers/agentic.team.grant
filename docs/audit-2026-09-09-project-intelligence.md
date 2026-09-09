# Audit: project intelligence, autonomy and the front end

**Date** 2026-09-09 · **Against** Grant's 21-section specification of 2026-09-09 ·
**Status** audit only — no architectural changes made.

Grant asked for this before any building: *"Before implementing changes, review the
existing architecture and determine what is already implemented, partially
implemented, broken, or missing. Do not create parallel systems where an existing
component should instead be repaired or extended."*

Every claim below is measured against the live system, not read off the code. Where
a number appears, the query or the browser run that produced it is named.

---

## How the audit was done

Three passes:

1. **Schema and data** — the live database over the Management API: every table, the
   project model, the connector model, the permission model, and the actual rows.
2. **Production behaviour** — latency percentiles and drop rates from
   `inbound_commands` joined to `jobs`, split before and after migration 0148.
3. **The front end in a real browser** — Chromium at three viewports (iPhone 14 at
   390px, iPad at 810px, desktop at 1440px), across all eleven tabs, with real
   section data stubbed in so the authenticated views actually render.

That third pass required building a harness that did not exist, which is itself the
first finding: **there are 777 unit tests and zero browser tests.** Nothing in this
repository has ever exercised the page in a browser. That is why §6 could be
believed broken and never confirmed.

The relay in this sandbox will not tunnel Chromium to `ai-team-hq.vercel.app`
directly, so the audit ran the page through a local reverse proxy. The HTML, CSS and
JavaScript are byte-identical to production; only the origin differs.

---

## Scorecard

| § | Requirement | State | One-line reason |
|---|---|---|---|
| 1 | Project-centric front end | 🔴 missing | Home is a 5,200px text page; projects are the 4th card down |
| 2 | Visual connections, logos | 🔴 missing | Connectors render as the string `notebooklm · source` |
| 3 | Detect and repair missing connections | 🔴 missing | Nothing computes "this project has no Notion page" |
| 4 | Project identity, aliases, duplicates | 🔴 missing | No alias table; creation **appends a numeric suffix by design** |
| 5 | UI/UX redesign, mobile-first | 🔴 broken | Overflow, sub-12px type, sub-44px targets — all measured |
| 6 | Talk to Team | 🟠 unverified | Renders and lays out fine; never tested in a browser; no fallback |
| 7 | Telegram/Slack under a minute | 🟠 partial | p50 55s / 65s, p90 147s / 134s in production |
| 8 | GitHub as a connector | 🔴 missing | One config string; not a connector; no GitHub identity |
| 9 | Notebook discovery across accounts | 🟠 researched | `list()` looks like a *recents* feed, not an ownership query |
| 10 | CoS as control plane | 🔴 missing | Action vocabulary covers notebook artifacts only |
| 11 | Voice notes as commands | 🟠 partial | Transcription and answering work; administration does not |
| 12 | Configuration not code | 🟢 mostly done | 11 config tables already; aliases and skills are the gap |
| 13 | Safety and change control | 🟢 mostly done | `tool_permissions.risk` 0–3 already matches your three tiers |
| 14 | "Create Project" experience | 🔴 missing | Needs §4 and §8 first |
| 15 | Autonomous multi-agent workflow | 🟠 partial | Planning and delegation work; project resolution is the gap |
| 16 | Artifact and knowledge management | 🟠 partial | Model is right; `notion.project_slug` is still empty |
| 17 | Completion reporting | 🔴 missing | No Created/Updated/Findings/Next structure exists |
| 18 | Adaptive team | 🟠 partial | Learning machinery exists; nothing learns aliases |
| 19 | One conversational control plane | 🟢 done | One command table, one queue, one worker, identities mapped |

Six red, nine orange, three green. The reds cluster in one place, which is the good
news: **almost all of them are downstream of §4.**

---

## The root finding

Your duplicate-project failure is not a bug. It is the documented behaviour of
`app.hq_create_project`, and the comment in the migration says so:

> *"A name someone else already used is a suffix, not an error. The front end should
> not make Grant think of a different name for his own project."*

The evidence is still in the database. `public.projects` contains a live row with
the slug **`ai-learning-2`**, and the notebook layer holds three confusable
notebooks: *"AI learning"*, *"AI Learning"* and *"AI Learning Two"*. The notebook
library's own source comments that **titles are not unique in NotebookLM**.

Underneath that, `app.resolve_project` resolves a project by exactly three routes:

1. an explicit UUID in the message,
2. a permanent Slack channel → project mapping,
3. the scope's "current project" switch,

and otherwise returns null, meaning *ask*. That is a careful, correct function — and
**none of those three routes is a name.** There is no path from the words "the
wellness project" or "Money Mastery" to a project id, anywhere in the system. No
alias table exists. `projects` has eight columns and none of them is a description.

So when you referred conversationally to a project that already existed, there was
no mechanism that could have recognised it, and the create path was built to
tolerate a name collision by suffixing it. Both halves have to change together.

---

## §5 — the front end, measured

Not opinion. This is what Chromium reported.

**Horizontal overflow.** iPhone 14, Connections tab: content is **533px wide in a
390px viewport**. The offending chain is `SECTION.card.wide → DIV.body → DIV.tiles`.
This is the only tab that overflows, and it overflows badly.

**Type below the legible floor.** Text at **10.5px–11.5px** on *every* tab at *every*
viewport — the header subtitle, and every card's section label ("Your day", "What
the team did"). Five distinct elements per page.

**Touch targets below 44px.** On iPhone, five of eleven tabs carry controls too small
to hit reliably:

| Tab | Control | Size |
|---|---|---|
| Projects | Rename | 69 × **26** |
| Projects | Detach | 62 × **26** |
| Routing | Switch on / Switch off | 55 × **36** |
| Settings | Connect Google → | 126 × **30** |
| Staff | pronoun picker | 89 × **35** |

**There is no mobile layout.** iPad (810px) and iPhone (390px) produced *identical*
findings and identical character counts on all eleven tabs. The whole 2,905-line page
contains four breakpoints: `min-width: 760px` three times and `1040px` once. What
exists is one desktop layout that reflows. Your words were *"Mobile should not merely
be a compressed desktop interface"* — at present that is precisely what it is.

**Prose before data.** Every card opens with an explanatory paragraph before showing
a single number. The overview screenshot on a phone runs to **5,202 pixels of scroll**
for a system with two projects, one pending decision and an empty queue. Projects
appear fourth, below "At a glance", "Needs you", and above "In flight" — rendered as
two flat text rows with no connections, no logos and no state.

---

## §7 — the latency numbers

Two different true statements, and the difference matters.

**On an idle queue** (`npm run verify:latency`, synthetic, one message at a time):
Telegram 11.6s, Slack 15.8s. Comfortably inside your minute.

**In production**, since migration 0148 landed (n=30):

| Surface | p50 | p90 | worst |
|---|---|---|---|
| Telegram | 55s | 147s | 342s |
| Slack | 65s | 134s | 671s |
| Voice | 93s | 26,301s | 40,459s |

Telegram makes the minute at the median and misses it at p90. Slack misses at both.
Voice misses badly, though its tail is inflated by `ask_the_team` delegations that
became genuine multi-hour research jobs — those are not "an unanswered message", and
separating them is itself work that does not exist yet.

The good news: **no commands are being dropped any more.** Before 0148, 55 of 160
inbound commands never became a job. Since 0148: **0 of 30.** That fix held.

The gap is that the only latency measurement in the system is a synthetic harness
that runs on an empty queue. Nothing measures what you actually experience.

---

## §9 — the Notebook research, which has an answer

You asked me to research before designing a workaround. Here is what the library
actually exposes.

`notebooks.list()` **takes no arguments at all** and is documented as returning
*"notebooks in backend-defined recent-first order"*. The same namespace also offers
`remove_from_recent(notebook_id)`.

A list with no owner filter, no sharing filter, no scope parameter, ordered by
recency, paired with a method for removing something *from recents* — that is the
signature of a **recently-viewed feed, not an ownership or sharing query.**

If that reading is right, it explains your symptom exactly: a notebook shared *to*
the Agentic Google account will not appear in discovery because nothing signed in as
that account has ever opened it. It is not a bug in our implementation and it is not
a permissions failure.

It also means the fix is small, because the library exposes direct addressing:

- `notebooks.get(notebook_id)` and `get_or_none(notebook_id)` — fetch one notebook by
  id, no listing involved.
- a complete `SharingAPI` (`get_status`, `add_user`, `set_users`, `remove_user`).

So the clean explicit-linking workflow you asked for as a fallback is available:
**paste the notebook URL → extract the id → `get()` it → attach it to the project.**
And there is a decent chance that simply opening the shared notebook once as the
Agentic account makes it appear in `list()` permanently.

**One experiment settles this** and it costs a few minutes. It is listed under
"What I need from you" below.

---

## What is already built, and must be extended rather than replaced

This is the part worth stating loudly, because the specification reads as if much of
it needs building and it does not.

**§13, safety tiers — already correct.** `public.tool_permissions` already grades
every capability 0–3, and the tiers map almost exactly onto the three you described:

- risk 0 — read (`db.read`, `notebook.read`, `web.search`, `calendar.read`)
- risk 1 — your "low risk, automatic" (`task.create`, `note.create`, `preference.update`)
- risk 2 — your "medium risk, with confirmation" (`calendar.write`, `slack.post`, `notebook.write`)
- risk 3 — your "high risk, explicit approval", and currently **disabled outright**
  (`db.delete`, `spend.money`, `production.write`, `gmail.send`)

The audit trail you asked for also exists: an append-only event ledger, a 14-state
job machine with `job_state_transitions`, and `undoable_actions` / `undo_requests`.
The gap is not the model — it is that these tiers govern *tools* and the new
administrative operations of §10 are not tools yet.

**§12, configuration not code — largely done.** Already persisted, not hard-coded:
`staff`, `staff_prompts`, `staff_tools`, `tool_permissions`, `responsibilities`,
`system_config` (49 keys), `autonomy_settings`, `notification_preferences`,
`telegram_bots`, `slack_channel_map`, `provider_models`. Missing from configuration:
**project aliases, per-project connector mappings, and skills.**

**§19, one control plane — done.** One `inbound_commands` table for all four
surfaces, one job queue, one worker, and `subject_identities` already maps you across
Slack, Telegram and voice. `verify:cross-interface` passes. The one thing not shared
across surfaces is project identity — because §4 does not exist.

**§10's precedent already exists.** `preference_instructions` turns an English
sentence into a stored notification preference, and logs the ones it did not
understand (*"make the dashboard blue and reticulate the splines"* is in there, duly
refused). That is the exact shape the administrative vocabulary should generalise —
one table, one resolver, an explicit refusal when it does not understand. It should
be extended, not paralleled.

**§8's extension point is clean.** `project_attachments.connector` is a foreign key
to `knowledge_connectors`. Adding a `github` row there makes GitHub a legal
attachment everywhere in the system at once — no new join, no parallel table. Today
GitHub is a single string, `github.repository = granterogers/agentic.team.grant`, and
`subject_identities` has no `github` row for you.

---

## Phased plan

Your instruction: foundational architecture before cosmetic work *where the cosmetic
work would otherwise be rebuilt*, but mobile and Talk to Team are high-priority
defects. Those resolve cleanly, because the mobile defects split in two.

The **local** defects — overflow, type scale, touch targets — are not rebuilt by the
project model. They go first. The **home screen redesign** is rebuilt by it, so it
waits for Phase 5.

### Phase 1 — the defects, and the harness that proves them (1–2 days)

- Fix the Connections overflow (`.card.wide .tiles` at 390px).
- Raise the type floor: nothing below 12px, and a real mobile type scale.
- Every interactive control to a 44px minimum touch target.
- **Commit the browser harness as `npm run verify:ui`** — three viewports, all tabs,
  asserting no overflow, no sub-12px text, no sub-44px targets, no console errors.
- **Add `npm run verify:talk`** — a real browser driving Talk to Team on a mobile
  viewport: touch, text entry, microphone permission, submission, backend
  processing, team response, and each failure state. Your words: *"Do not consider
  this resolved simply because the component renders."* This is what stops that.

Independently testable, ships alone, and nothing later invalidates it.

### Phase 2 — project identity (the keystone)

- `projects` gains `description` and `purpose`.
- New `project_aliases` table: many aliases to one canonical project, with a source
  (you said it / the system inferred it) and a confidence.
- `app.resolve_project_by_name(text)` — exact, then alias, then normalised, then
  fuzzy/semantic — returning **candidates with confidence**, never a silent pick.
- `app.hq_create_project` **stops suffixing**. On a near match it returns the
  candidates and asks. A high-confidence match resolves automatically and tells you
  it did, exactly as you described.
- Backfill and merge `ai-learning-2` — with your confirmation, not on my judgement.

### Phase 3 — GitHub as a first-class connector

- A `github` row in `knowledge_connectors`, making it a legal project attachment.
- A `github` row in `subject_identities` for you, so *"my Rest Timer repo"* resolves
  with no URL.
- Private repos via a **fine-grained personal access token** in the Supabase Vault.
  That is the safest practical mechanism here: scoped to chosen repositories,
  read-only by default, independently revocable, no third-party app installation, and
  no OAuth callback surface to defend.
- Read first: repositories, branches, README and docs, issues, releases, source tree,
  file contents, recent activity. Writes stay behind the risk-3 gate.

### Phase 4 — connection state and repair (§2, §3)

- `app.project_connections(project_id)` returning every connector with a state:
  connected / missing / broken / deliberately disconnected.
- The five choices you listed, including **"deliberately leave disconnected"** stored
  as a real state so the UI stops nagging.
- No automatic creation of a counterpart just because one is missing.

### Phase 5 — the project-centric front end (§1, §5)

Only now, because only now is there something to draw: a project, its connectors,
their real state and their logos. Node/graph home screen, progressive disclosure,
mobile-first with genuinely distinct phone / tablet / desktop layouts. Guarded by the
Phase 1 harness from the first commit.

### Phase 6 — the Chief of Staff as control plane (§10, §12, §13)

- An `operations` registry — the administrative verbs (add an agent, grant a tool,
  create a skill, connect a project, change a routing rule), each carrying a risk
  tier that **reuses `tool_permissions`** rather than inventing a second scheme.
- Tier 1 automatic, tier 2 confirmed, tier 3 explicitly approved, everything on the
  ledger, reversible through the existing undo machinery where it can be.

### Phase 7 — reporting and knowledge (§9, §16, §17)

- Completion reports: Created / Updated / Key findings / Recommended next actions,
  with artifact names that open. The data is already in `artifacts.url`; nothing
  assembles it.
- Notebook explicit linking, once the experiment below has settled §9.
- `notion.project_slug`, once you have told me which project those pages belong to.

---

## What I need from you

Nothing here is blocking Phase 1, which I can start immediately.

1. **`ai-learning-2`** — there are two projects, *"AI learning"* (`ai-learning-2`) and
   *"AI Team HQ Test"* (`ai-team-hq-test`), and three notebooks with confusable names.
   Should `ai-learning-2` be merged into something, renamed, or archived? I will not
   touch it until you say.

2. **The shared notebook** — send me its URL (the `notebook.google.com/notebook/<id>`
   link). Then, signed in as the Agentic Google account at
   https://notebooklm.google.com, open that notebook once and tell me. Those two
   things together settle §9 definitively: if it appears in discovery afterwards,
   the answer is "open it once"; if not, the answer is explicit linking by id, which
   I will build.

3. **GitHub access.** When you are ready for Phase 3, create a fine-grained token at
   https://github.com/settings/personal-access-tokens/new — set *Resource owner* to
   your account, *Repository access* to **Only select repositories** and choose the
   ones the team may see (Rest Timer included), and under *Repository permissions*
   grant **Contents: Read-only**, **Metadata: Read-only**, **Issues: Read-only**.
   Nothing else, and no write permission yet. Send it to me on Telegram, never here —
   it goes straight into the vault and is never printed.

4. **`notion.project_slug`** — the Notion sync duty has been asking every two hours
   since it was built, and refusing to guess. Which project do the shared Notion
   pages belong to?

5. Two decisions still open from before: whether `vault-export` runs weekly (built,
   tested, currently disabled), and D2 — whether a paid model writes the prose you
   read. `voice.writing_model` is the switch; today it is empty and the free tier is
   about half as good as it should be.

---

## What this audit deliberately did not do

No schema was changed, no code was written, nothing was deployed. The only artifacts
are this document and a browser harness sitting in a scratch directory, which becomes
`verify:ui` and `verify:talk` in Phase 1.

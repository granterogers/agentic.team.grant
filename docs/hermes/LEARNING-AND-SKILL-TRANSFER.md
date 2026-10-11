# Hermes integration: learning and skill transfer

Fixed decisions this implements: **reviewed learning only** (Hermes may produce skill-improvement proposals, no automatic adoption), and
**the existing team should be able to learn from observable Hermes behaviour and validated skills**. Milestone M8 builds it; nothing here
runs before M0–M6 are done.

## 1. What already exists, and is reused unchanged

| Mechanism | Where | Property this design relies on |
|---|---|---|
| `public.skills` | `migrations/0212_a_skill_is_a_procedure_with_no_address_in_it.sql` | a procedure (40–4,000 chars) with a name and a `when_to_use`, scoped global/project/staff/kind; **may name tools, may not name addresses** (refused at insert, ADR-0017); append-only; authored and linked to `from_job` |
| `public.skill_tools` | same | tools by foreign key to `tool_permissions`: a skill cannot invent a tool, and naming one grants nothing (`staff_may_use` never reads it) |
| `app.teach_skill` | `migrations/0740…:393` | the one writer, office-first |
| `public.suggestions` + `app.decide_suggestion` | `migrations/0741…:389-470` | `offer_kind = 'teach_skill'` calls `app.teach_skill` only from a person's press; locked against double presses; a refusal is an answer and the offer stays open |
| `guidanceFor` | `src/agents/guidance.ts`, called at `src/handlers/instruction.ts` ~6600 | an approved skill reaches every relevant team prompt; `recordSkillUse` counts it |
| Governance page | Team HQ settings | where suggestions are shown and decided |

**No new skill table, no Hermes skill store, no new review page.** The only schema change is one argument (§5.3).

## 2. Two sources of a proposal

| Source | What it is | Trust | Milestone |
|---|---|---|---|
| **A. Hermes-authored skill** | A `SKILL.md` Hermes wrote with `skill_manage` during or after a run, into an isolated directory | untrusted model output, possibly shaped by content Hermes read | M8b |
| **B. Observed technique** | The office's own record of a completed run: which read tools were called, in what order, against which kind of question, and whether the person kept the answer | office evidence (`engine_run_calls`) | M8a |

Source B is built first because its evidence is the office's own and it needs no Hermes feature enabled. Source A needs the skills toolset
switched on in an isolated profile, which is experimental ([ASSUMPTION V10]).

## 3. The pipeline

```
completed engine run ──► eligibility ──► draft (A: harvested SKILL.md │ B: composed from engine_run_calls)
                                              │
                                              ▼
                              convert to the office shape (§4)  ──refused?──► dropped, counted, reason recorded
                                              │
                                              ▼
                       public.suggestions (kind 'engine.skill', offer_kind 'teach_skill', offer_args …)
                       + external.skill_proposed on the activity ledger when merged
                                              │
                                     Governance page: the person reads the procedure, the tools it names,
                                     what did NOT transfer, and a link to the run that produced it
                                              │
                         Accept ──► app.decide_suggestion ──► app.teach_skill ──► public.skills (+ skill_tools)
                                              │                                  │
                         Dismiss ──► suppressed (kind, subject)                  ├─► team: guidanceFor
                                                                                  └─► Hermes: exported read-only (§6)
```

**Eligibility.** The run is `completed`; its output was committed and delivered; the person did not mark it "not useful" within 24 hours
(the existing output feedback); no containment or approval-denial note is on the run; at most **3 proposals per office per day** and one per
run. The proposal round runs as part of the existing daily suggestion round (`app.raise_suggestions`) so it adds no new duty.

## 4. Conversion to the office shape (`src/engines/hermes/skills.ts`, pure, unit-tested)

```ts
/** What the bridge harvests from Hermes (source A) or the office composes (source B). Untrusted text in every field. */
export interface HermesSkillDraft {
  readonly name: string          // from SKILL.md frontmatter `name`        [SRC skills/**/SKILL.md frontmatter]
  readonly description: string   // frontmatter `description`
  readonly body: string          // the markdown after the frontmatter
  readonly files: readonly string[]   // relative paths of references/, templates/, scripts/, assets/ (names only, never contents)
  readonly source: 'hermes_authored' | 'observed'
  readonly run_id: string
}

export type Conversion =
  | { readonly ok: true; readonly offer: TeachSkillOffer; readonly dropped: readonly string[] }
  | { readonly ok: false; readonly reason: string }

export interface TeachSkillOffer {
  readonly name: string            // 3..80, trimmed, de-duplicated against live skill names ("(from Hermes)" suffix on clash)
  readonly when: string            // 12..400, from description
  readonly procedure: string       // 40..4000, Markdown kept, sections cut from the end with a marker if longer
  readonly scope: 'project' | 'global'   // project when the run had a project, else global
  readonly project_id: string | null
  readonly tools: readonly string[]      // office tool ids (tool_permissions.tool), mapped; unmappable mentions are listed in `dropped`
  readonly from_job: string
  readonly source: 'hermes'
}
export function convertSkill(draft: HermesSkillDraft, map: ToolMap): Conversion
```

Rules, each a unit test with a negative control:

1. **Addresses** (URL, hostname, IP literal, email) → `ok: false` before the database sees it, using the SAME pattern the 0212 insert check
   uses (read it from the migration; do not write a second regex). The insert check remains the authority.
2. **Code does not transfer.** `scripts/`, `templates/`, `assets/` and fenced code blocks that are shell or Python are removed from the
   procedure and listed in `dropped` ("2 scripts and a shell block were not transferred: the team cannot run code"). A procedure that is
   empty after removal → `ok: false`.
3. **Tools by mapping only.** Hermes names office tools as MCP tool names (prefix per V12); `ToolMap` (in `tools.ts` beside
   `ENGINE_READ_TOOLS`) maps each to `tool_permissions.tool`. Mentions of Hermes built-ins (terminal, browser, web_search, execute_code,
   delegate_task, …) are listed in `dropped` and make the procedure carry a first line: "Hermes used <x>, which the team does not have."
4. **Injection hygiene.** The procedure is stored as text and rendered escaped (`esc()`); it is never executed or used as a system prompt
   by Hermes again (the export in §6 is to its reference directory, read-only, and only after approval).
5. **Bounded.** Over-length bodies are cut at a section boundary, never mid-word, with "(shortened)".

Source B composes the draft from the run's served calls, e.g. *name* "Answering budget questions on a project"; *when* the person's question
class (the first clause of the request, ≤ 120 chars, untrusted); *procedure* the ordered tools with their arguments' SHAPE (never values),
plus the observed outcome counts. It is deliberately modest: it captures *what to look at*, not prose Hermes wrote.

## 5. Changes to existing code (small, M8)

1. `app.decide_suggestion`'s `teach_skill` branch passes `p_tools => array(select jsonb_array_elements_text(s.offer_args -> 'tools'))`
   to `app.teach_skill` (it passes none today, so an accepted skill records no tools). Spliced from the LIVE definition
   (`pg_get_functiondef`), one argument added, migration **1071**.
2. The Governance page's suggestion card renders `offer_args.dropped` and a link to the run (`engine_runs.job_id` → the thread) when
   `kind = 'engine.skill'`.
3. `engine` gateway `POST /engine/proposal` (source A only): validates `HermesSkillDraft` shape and size, calls `convertSkill`, then
   `app.engine_propose_skill(p_office, p_run, p_offer jsonb)` which writes the suggestion (office-first, run must be this bridge's and
   `completed`, daily cap enforced in SQL).

## 6. Approved skills go back to Hermes, read-only

Hermes reads extra skill directories from `skills.external_dirs`, which are read-only to it; creation always writes elsewhere
**[SRC cli-config.yaml.example: skills.external_dirs comment; tools/skill_manager_tool.py:1-8, 201-207]**. The bridge, at start and hourly,
asks the engine gateway for the office's live skills with `source = 'hermes'` OR scope global (`GET /engine/skills`, returning name,
when_to_use, procedure) and writes them as `<dir>/<slug>/SKILL.md` under a directory listed in `external_dirs`, replacing the directory
atomically. So:

- the team learns from Hermes (§3), and
- Hermes uses the office's approved procedures, including ones the team wrote,
- and neither learns anything a person did not approve.

**Can the team genuinely reproduce an approved Hermes technique?** Only the procedural part, and only with tools the team holds. A
skill naming a tool the answering agent lacks describes an unavailable step; the existing route then applies (impediment → noticing →
Grant grants the tool on the Team page). Techniques that depend on terminal, code, browser or web access do not transfer, and every
proposal says so in `dropped`. This limit is a property of the office's tool boundary, which is correct, and is stated on the card.

## 7. Source A harvesting (M8b, experimental)

- A second Hermes profile `hermes-learn` (multiplexed profiles, `/p/<profile>/…` **[SRC api_server.py:4488-4492]**, [ASSUMPTION V11])
  with the `skills` toolset enabled, `skills.create_dir` pointing at an empty directory per run, `background_review.enabled: true`
  on the auxiliary free lane, everything else as the production profile. The production profile keeps skills off.
- Hermes skill writes are scanned by its own `skills_guard` only for installs, not for its own creations
  **[SRC tools/skills_guard.py:1-30]**, so the office's conversion (§4) is the gate, not Hermes's.
- After the run's terminal event and the background review's completion (bounded wait 120 s), the bridge reads every new or changed
  `SKILL.md` under that run's directory, sends each as a `HermesSkillDraft`, then deletes the directory. Nothing persists on the host
  between runs, so Hermes cannot reuse an unreviewed skill (fixed decision 2).
- Which profile a run uses is decided by the office at open (`engine_runs.profile`, returned as `ClaimedRun.profile`), not by the bridge, and only when the person switched
  "Let Hermes suggest skills" on for the office (a second `system_config` list, `engine.hermes.learning_offices`).

## 8. What success looks like, measurably

`npm run measure` gains three lines (M8): proposals raised, accepted, dismissed per source; accepted Hermes skills used by the team
(`recordSkillUse` counts); and answers by the team that used an accepted Hermes skill and were not marked "not useful". If proposals are
mostly dismissed after a month of beta, source A is switched off: the measure, not enthusiasm, decides.

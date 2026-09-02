# Research: Claude Code capabilities available for this build

**Inspected:** 2026-09-02
**Spec sections validated:** "Claude Code Model / Reasoning Strategy", "Development Environment: Fully Cloud-Based", §28 Phase 0

This documents what is *actually* available in Grant's current environment,
rather than what the specification assumed. The spec explicitly requires this
inspection before substantive implementation, and explicitly forbids pretending
the top-level session model has changed when it has not.

---

## Verified environment

| Property | Value | How verified |
|---|---|---|
| Claude Code CLI (session) | `2.1.42` | `$CLAUDE_CODE_VERSION` |
| Claude Code CLI (container) | `2.1.258` | session metadata |
| Configured model | `claude-opus-5` | session metadata `configured_model` |
| Currently serving model | `claude-opus-5` | session metadata `last_served_model` |
| Reasoning effort | `medium` | `$CLAUDE_EFFORT` / session `effort_level` |
| Max thinking tokens | `31999` | `$MAX_THINKING_TOKENS` |
| **Max subagent spawn depth** | **`1`** | `$CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` |
| Environment kind | `anthropic_cloud` / `cloud_default` | session metadata |
| Permission mode | `auto` | session metadata |
| Origin | `desktop_app` | session metadata |
| Repo | `granterogers/agentic.team.grant`, branch `claude/new-session-o2oklu` | session metadata |
| Node / Python / git | v22.22.2 / 3.11.15 / 2.43.0 | `node -v`, `python3 -V`, `git --version` |
| Chromium for Playwright | pre-installed at `/opt/pw-browsers` | `$PLAYWRIGHT_BROWSERS_PATH` |

Confirmed: this is a cloud environment, the repository is cloned fresh per
session, and there is no local development machine — matching the spec's
"Development Environment: Fully Cloud-Based" section.

---

## Model / delegation strategy — as actually configurable

The spec's intent ("plan with the strongest model, execute with Sonnet") is
achievable here, but **not** by switching the top-level session model from
inside a prompt. The mechanism that genuinely exists is **subagent delegation
with a per-agent model override**.

| Spec intent | Actual mechanism available |
|---|---|
| Strongest reasoning for architecture, security, hard debugging, acceptance review | The **top-level session** (Opus 5) does this directly. Raise `effort` to high/xhigh for genuinely hard passes. |
| Sonnet-class for most implementation, tests, frontend, refactoring | Delegate via the Agent tool with `model: sonnet`. |
| Haiku-class for mechanical edits and boilerplate | Delegate via the Agent tool with `model: haiku`. |
| "Automatic delegation" to model-specific advisors | Define reusable agents in `.claude/agents/*.md` with `model:` set in frontmatter. |

### The constraint that shapes the plan

**`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = 1`.** Subagents cannot spawn their own
subagents. Therefore:

- All fan-out must be **orchestrated from this top-level session**. A delegated
  agent cannot itself parallelise its work.
- Delegated tasks must be sized to be completable by one agent working alone.
- The top-level session remains the only orchestrator and the only place where
  cross-cutting synthesis happens. This is a good fit for the spec's acceptance-
  review model: the strongest capability reviews, and it cannot be delegated away.

### Recommended configuration

1. **Keep the top-level session on Opus 5.** It does architecture, phase
   planning, cross-cutting decisions, security review, and the mandatory
   per-phase acceptance review. Do not delegate acceptance review — the spec
   requires the strongest capability to sign off each phase gate.
2. **Raise effort to `high` deliberately**, for: initial architecture, the
   schema/ledger design in Phase 1, security review, and any debugging that has
   already failed twice. Leave it at `medium` for routine orchestration to
   conserve usage.
3. **Define these reusable agents in `.claude/agents/` once implementation
   starts** (not before — there is no code to work on yet):
   - `implementer` (`model: sonnet`, high effort) — feature implementation
     against a written spec and an acceptance test.
   - `test-author` (`model: sonnet`) — unit/integration/failure-injection tests.
   - `mechanical` (`model: haiku`) — boilerplate, renames, codegen-shaped edits.
   - `researcher` (`model: sonnet`, web tools) — third-party doc verification,
     as used for this Phase 0 research pass.
4. **Escalation rule, per the spec's usage discipline:** if the same failure
   recurs twice under a delegated agent, stop delegating it. Pull the problem
   back to the top-level session at high effort and treat it as a design defect
   rather than an implementation defect. Never stack code on a repeatedly
   failing architectural assumption to conserve credits.

### Usage observed during Phase 0 research

Session cost at time of writing: **$1.17**. Rate-limit status
`allowed_warning`, not in overage. Recorded here as the baseline for the
per-phase usage discipline the spec asks for — research-heavy phases are cheap
relative to implementation phases, so front-loading research is also the
economical choice.

---

## Available integrations in this environment

Relevant to the build, verified present as MCP servers / tools in-session:

- **GitHub** — full repo, PR, issue, and Actions access. Note: the `gh` CLI is
  *not* available; GitHub work goes through MCP tools.
- **Intercom** — present but not required by this specification.
- **Claude Code Remote** — session management, scheduled triggers (`create_trigger`,
  `send_later`). *Potentially useful for the build itself* (e.g. scheduling a
  long-running check), but **must not be confused with the product's own
  scheduler.** Team HQ's 10-minute Notebook sync must run on its own
  infrastructure, not on Claude Code triggers — see the spec's rule that the
  product must not be architected around Anthropic or Claude Code.
- **Web search / fetch** — used for this research pass.
- Repository access is scoped to `granterogers/agentic.team.grant` only.

### Important boundary

Claude Code is the **development agent only**. Nothing in the delivered product
may depend on Claude Code, the Agent tool, Anthropic models, or this session's
MCP servers at runtime. The agent engine in Phase 5 must be built on the
product's own provider-abstraction layer.

---

## Three separate secret stores — confirmed understanding

The spec (§26, and the cloud-environment section) requires Claude Code to
confirm it understands which store a given task needs. Confirmed:

| Store | Used by | Contains | Set where |
|---|---|---|---|
| **Cloud environment: Environment variables** | Claude Code build/test sessions | bootstrap credentials, pasted in `.env` format | claude.ai/code → environment gear icon |
| **Cloud environment: API credentials** | Claude Code sessions, via Anthropic's outbound proxy | sensitive keys, attached *after* leaving the session so the raw value never enters the session or logs | same environment settings |
| **GitHub Actions secrets** | CI workflows only | CI-only values | repo Settings → Secrets and variables → Actions |
| **Production app secrets** | the deployed Team HQ runtime | OpenAI, Supabase, Telegram, Slack, Google credentials entered by Grant in the running app | app's own encrypted store (Settings → Connections & Secrets) |

These do not overlap. GitHub Actions secrets are **not** readable by Claude Code
cloud sessions. Production secrets are **never** inherited from the Claude Code
environment.

**Verified current state:** no bootstrap credentials are present in this
environment yet. Checked by name for `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `GROQ_API_KEY` — all absent. This is
expected at this stage and is what `docs/prerequisites.md` addresses.

### Candidates for migration to API credentials

Per the spec's instruction to flag these proactively rather than leaving
everything as plain environment variables: once each connection is proven
working, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and every Telegram bot
token should move from Environment variables to API credentials. The Gemini
Notebook `master_token.json` is a special case — it is a file, not a header
value, so it cannot use the API-credentials mechanism and must be handled as
described in the prerequisites.

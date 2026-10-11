# ADR-0073: Hermes is a manually chosen engine for one turn; the office keeps everything else

**Status:** accepted for implementation (architecture phase, 11 October 2026). **Branch:** `feature/hermes-agent-integration`.
**Detail:** `docs/hermes/ARCHITECTURE-DECISIONS.md` (HD-1 to HD-14) and the rest of `docs/hermes/`.

## Context

Grant asked for Nous Research's Hermes Agent as an alternative execution engine, chosen manually, at zero additional cost, with the task
system and approval policies remaining authoritative and learning only by review. The worker is a Supabase Edge Function (150 s, 2 s CPU)
and cannot run Hermes, which is a long-lived Python application.

## Decision

1. The person chooses the engine per message (`inbound_commands.engine`: `team` default, `hermes`). No automatic delegation or fallback.
2. The `office.instruction` job opens one `engine_runs` row and pauses (`dependency_wait`); an outbound-only bridge beside Hermes claims it
   through a new `engine` edge function and drives Hermes's local `/v1/runs` HTTP API; the job resumes and the answer becomes an ordinary
   output that passes every existing gate.
3. Hermes's only tools are the office's own MCP server with a new `engine` client kind: read tools, bound by the database to the running
   run's project, every call recorded and used as the answer's grounding. Writes are refused in SQL until a later milestone routes them
   through `app.authorize_effect`.
4. Hermes holds no authoritative memory; learning reaches `public.skills` only through `public.suggestions` and a person's press.
5. Hermes uses only `:free` models on a zero-credit key; it runs on hardware Grant chooses.

## Consequences

- One owner for every fact; no second approval system; Hermes can be switched off per office instantly by a `system_config` list.
- Hermes is unavailable whenever its host is off, and the composer says so.
- Reversing this needs: the off switch, then draining open runs, then a worker restore, in that order
  (`docs/hermes/IMPLEMENTATION-BLUEPRINT.md` §11), because an older worker would answer a parked Hermes turn with the team.

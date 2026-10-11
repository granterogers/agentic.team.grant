/**
 * The numbers every part of the Hermes engine agrees on. Pure: no Deno or Node API, imported by the worker handler, the bridge and the
 * replica proof. The database holds the same numbers in migration 1070; `scripts/isolated/engine-runs.ts` reads them back from the
 * database and fails if they disagree, so a change here is a change there in the same commit (two copies compared by eye is how they
 * come to differ).
 */

/** A bridge that has not been heard from for this long makes Hermes unavailable. */
export const BRIDGE_FRESH_S = 120

/** How long a claim or a heartbeat extends a run's lease. A bridge that goes quiet for this long loses its run. */
export const LEASE_S = 90

/** How often a bridge sends a heartbeat while a run is live. */
export const HEARTBEAT_S = 5

/** A run is claimed at most this many times (an attempt each) before it fails as bridge_lost. */
export const MAX_CLAIMS = 3

/** A bridge's last_seen_at is moved at most this often. */
export const BRIDGE_TOUCH_S = 10

/** How long from open to expiry, and the bounds the setting is clamped to. */
export const DEADLINE_DEFAULT_S = 900
export const DEADLINE_MIN_S = 120
export const DEADLINE_MAX_S = 1800

/** Runs per office per UTC day, and the bounds the setting is clamped to. */
export const DAILY_RUNS_DEFAULT = 20
export const DAILY_RUNS_MAX = 1000

/** The bridge stops a run that has produced no event for this long (Hermes retries a provider 500 for ever; M0 D-3). */
export const NO_PROGRESS_S = 90

/** The bridge waits this long for Hermes to confirm a stop before it reports the run. */
export const STOP_WAIT_S = 30

/** Idle polling: 15 s, easing to 60 s after ten idle minutes. */
export const POLL_IDLE_S = 15
export const POLL_QUIET_S = 60
export const POLL_QUIET_AFTER_S = 600

/** Sizes. The database enforces the same limits. */
export const LIMITS = {
  input: 20_000,
  instructions: 12_000,
  historyTurns: 20,
  historyChars: 24_000,
  answer: 16_000,
  failure: 300,
  excerpt: 4_000,
  groundingChars: 24_000,
  requestBytes: 65_536,
  resultBytes: 32_768,
  notes: 5,
} as const

/** The system_config keys. Absent or malformed means off (or the default); nothing here is ever on by itself. */
export const SETTING = {
  offices: 'engine.hermes.offices',
  dailyRuns: 'engine.hermes.daily_runs',
  deadlineS: 'engine.hermes.deadline_s',
} as const

/** The tool-name prefix Hermes puts on MCP tools (M0 V12, finding D-1). */
export const OFFICE_TOOL_PREFIX = 'mcp__office__'

/**
 * The read tools an engine client may call in v1. The SQL function app.engine_read_tools holds the same list and the proof compares
 * them; the MCP function's ENGINE_READ_TOOLS must equal both.
 */
export const ENGINE_READ_TOOLS: readonly string[] = [
  'check_job',
  'inspect_activity',
  'list_events',
  'list_projects',
  'list_staff',
  'list_tasks',
  'read_document',
  'recent_work',
  'search_documents',
  'search_project',
]

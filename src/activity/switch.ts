/**
 * Planning and applying the ledger's switches (docs/activity-ledger/MIGRATION-PLAN.md, stage D).
 *
 * Two settings decide whether the ledger is on for an office (app.activity_ledger_covers, migration 1060). The rule is FAIL CLOSED:
 *   activity.ledger_enabled   the MASTER switch and kill switch: only the JSON value true is on
 *   activity.ledger_offices   what the master covers: an array of office ids (those offices), or exactly the object
 *                             {"version":1,"mode":"all"} (every office). A missing row, null, [], or anything else covers NO office.
 *
 * `planSwitch` is pure: what an operator asked for plus what the settings read now becomes the exact statements to run, in order, each
 * guarded by a compare-and-swap on the value that was READ (so two operators, or a change between the plan and the apply, cannot
 * silently broaden access: the statement matches nothing and the apply stops), or a refusal. `applyPlan` runs them and stops at the first
 * statement that did not apply. Order is the safety: the allowlist is written before the master is turned on, narrowing is one statement,
 * and turning off writes the master only. An interruption after any statement leaves the ledger on for the same offices or fewer.
 */
import type { SqlExecutor } from '../db/executor.ts'

export const MASTER_KEY = 'activity.ledger_enabled'
export const OFFICES_KEY = 'activity.ledger_offices'
/** The one value that means every office. Anything else shaped like it (another version, another mode, an extra key) means none. */
export const ALL_OFFICES_VALUE = { version: 1, mode: 'all' } as const
export const CONFIRM_ALL_PHRASE = 'ALL OFFICES'

export type Allowlist =
  | { readonly kind: 'absent' }
  | { readonly kind: 'offices'; readonly offices: readonly string[] }
  | { readonly kind: 'all' }
  | { readonly kind: 'invalid' }

export interface SwitchState {
  readonly master: boolean
  /** The stored JSON text of the master row, or null when there is no row (the compare-and-swap guard). */
  readonly masterJson: string | null
  readonly allowlist: Allowlist
  /** The stored JSON text of the allowlist row, or null when there is no row. */
  readonly allowlistJson: string | null
}

export type SwitchRequest =
  | { readonly kind: 'status' }
  | { readonly kind: 'canary'; readonly offices: readonly string[] }
  | { readonly kind: 'add'; readonly offices: readonly string[] }
  | { readonly kind: 'remove'; readonly offices: readonly string[] }
  | { readonly kind: 'all'; readonly confirm: string }
  | { readonly kind: 'off' }

export interface PlannedStatement {
  readonly sql: string
  readonly why: string
}

export type SwitchPlan =
  | {
      readonly ok: true
      readonly headline: string
      readonly current: string
      readonly proposed: string
      readonly statements: readonly PlannedStatement[]
      readonly noop: boolean
    }
  | { readonly ok: false; readonly refusal: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const lit = (json: string): string => `'${json.replace(/'/g, "''")}'::jsonb`

/** What the two stored values mean, exactly as app.activity_ledger_covers reads them. */
export const readState = (masterJson: string | null, allowlistJson: string | null): SwitchState => {
  const parse = (s: string | null): { ok: boolean; value: unknown } => {
    if (s === null) return { ok: true, value: undefined }
    try {
      return { ok: true, value: JSON.parse(s) as unknown }
    } catch {
      return { ok: false, value: undefined }
    }
  }
  const m = parse(masterJson)
  const a = parse(allowlistJson)
  let allowlist: Allowlist
  if (allowlistJson === null || !a.ok)
    allowlist = allowlistJson === null ? { kind: 'absent' } : { kind: 'invalid' }
  else if (Array.isArray(a.value)) {
    allowlist = {
      kind: 'offices',
      offices: [
        ...new Set(a.value.filter((x): x is string => typeof x === 'string' && UUID.test(x))),
      ].sort(),
    }
  } else if (a.value === null) allowlist = { kind: 'absent' }
  else if (
    typeof a.value === 'object' &&
    JSON.stringify(sortKeys(a.value)) === JSON.stringify(sortKeys(ALL_OFFICES_VALUE))
  )
    allowlist = { kind: 'all' }
  else allowlist = { kind: 'invalid' }
  return { master: m.ok && m.value === true, masterJson, allowlist, allowlistJson }
}

const sortKeys = (v: unknown): unknown =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, x]) => [k, x]),
      )
    : v

/** The effective result in words an operator cannot misread. */
export const effective = (master: boolean, allowlist: Allowlist): string => {
  if (!master) return 'NO OFFICE (master switch off)'
  if (allowlist.kind === 'all') return 'EVERY OFFICE (global activation)'
  if (allowlist.kind === 'offices') {
    return allowlist.offices.length === 0
      ? 'NO OFFICE (master on, allowlist empty)'
      : `${String(allowlist.offices.length)} OFFICE(S) ONLY: ${allowlist.offices.join(', ')}`
  }
  if (allowlist.kind === 'invalid') return 'NO OFFICE (master on, allowlist INVALID and ignored)'
  return 'NO OFFICE (master on, no allowlist)'
}

const setOffices = (state: SwitchState, value: unknown, why: string): PlannedStatement => {
  const json = JSON.stringify(value)
  return {
    why,
    sql:
      state.allowlistJson === null
        ? `insert into public.system_config (key, value, description) values ('${OFFICES_KEY}', ${lit(json)}, 'Offices the activity ledger is on for, narrowing activity.ledger_enabled (1060 to 1062).') on conflict (key) do nothing returning key`
        : `update public.system_config set value = ${lit(json)}, updated_at = app.now_utc() where key = '${OFFICES_KEY}' and value = ${lit(state.allowlistJson)} returning key`,
  }
}

const setMaster = (state: SwitchState, on: boolean, why: string): PlannedStatement => ({
  why,
  sql:
    state.masterJson === null
      ? `insert into public.system_config (key, value, description) values ('${MASTER_KEY}', '${String(on)}'::jsonb, 'Whether the native activity ledger accepts writes and the activity read section answers (1060).') on conflict (key) do nothing returning key`
      : `update public.system_config set value = '${String(on)}'::jsonb, updated_at = app.now_utc() where key = '${MASTER_KEY}' and value = ${lit(state.masterJson)} returning key`,
})

export const planSwitch = (request: SwitchRequest, state: SwitchState): SwitchPlan => {
  const current = effective(state.master, state.allowlist)
  const done = (
    headline: string,
    next: { master: boolean; allowlist: Allowlist },
    statements: PlannedStatement[],
  ): SwitchPlan => ({
    ok: true,
    headline,
    current,
    proposed: effective(next.master, next.allowlist),
    statements,
    noop: statements.length === 0,
  })
  if (request.kind === 'status')
    return done(
      'STATUS (nothing will be written)',
      { master: state.master, allowlist: state.allowlist },
      [],
    )
  if (request.kind === 'off') {
    const already = state.masterJson !== null && state.master === false
    return done(
      'KILL SWITCH: master off for every office (the allowlist is left as it is)',
      { master: false, allowlist: state.allowlist },
      already ? [] : [setMaster(state, false, 'turn the master switch off')],
    )
  }
  if (request.kind === 'all') {
    if (request.confirm !== CONFIRM_ALL_PHRASE) {
      return {
        ok: false,
        refusal: `global activation turns the ledger on for EVERY office, the Sample and every future person included. Repeat the request with --confirm="${CONFIRM_ALL_PHRASE}" to say you mean it. Use --canary <office-id> for a single office.`,
      }
    }
    const next = { master: true, allowlist: { kind: 'all' } as Allowlist }
    const statements: PlannedStatement[] = []
    if (state.allowlist.kind !== 'all')
      statements.push(
        setOffices(
          state,
          ALL_OFFICES_VALUE,
          'write the explicit global mode (the master may still be off, so nothing is on yet)',
        ),
      )
    if (!state.master)
      statements.push(setMaster(state, true, 'turn the master on (last, after the allowlist)'))
    return done('GLOBAL ACTIVATION: EVERY OFFICE', next, statements)
  }
  // canary / add / remove: all take office ids
  if (request.offices.length === 0)
    return {
      ok: false,
      refusal:
        'name at least one office id (an empty list would turn the ledger on for no one: that is --off)',
    }
  const bad = request.offices.filter((o) => !UUID.test(o))
  if (bad.length > 0)
    return {
      ok: false,
      refusal: `${String(bad.length)} office id(s) are not lower-case UUIDs: ${bad.map((b) => JSON.stringify(b.slice(0, 40))).join(', ')}`,
    }
  const ids = [...new Set(request.offices)].sort()
  if (request.kind === 'canary') {
    const same =
      state.allowlist.kind === 'offices' &&
      JSON.stringify(state.allowlist.offices) === JSON.stringify(ids)
    const statements: PlannedStatement[] = []
    if (!same)
      statements.push(
        setOffices(
          state,
          ids,
          state.allowlist.kind === 'all'
            ? 'NARROW from every office to exactly these'
            : 'write the allowlist (before the master)',
        ),
      )
    if (!state.master)
      statements.push(setMaster(state, true, 'turn the master on (last, after the allowlist)'))
    return done(
      `CANARY: ${String(ids.length)} OFFICE(S) ONLY`,
      { master: true, allowlist: { kind: 'offices', offices: ids } },
      statements,
    )
  }
  if (state.allowlist.kind !== 'offices') {
    return {
      ok: false,
      refusal: `--${request.kind} edits an existing list of offices, and the allowlist is ${state.allowlist.kind === 'all' ? 'the global mode' : state.allowlist.kind === 'invalid' ? 'INVALID (ignored: no office is on)' : 'absent (no office is on)'}. Use --canary <ids> to write a list.`,
    }
  }
  const have = new Set(state.allowlist.offices)
  const next =
    request.kind === 'add'
      ? [...new Set([...have, ...ids])].sort()
      : [...have].filter((o) => !ids.includes(o)).sort()
  const changed = JSON.stringify(next) !== JSON.stringify([...have].sort())
  return done(
    request.kind === 'add'
      ? `ADD ${String(ids.length)} OFFICE(S) to the canary`
      : `REMOVE ${String(ids.length)} OFFICE(S) from the canary`,
    { master: state.master, allowlist: { kind: 'offices', offices: next } },
    changed
      ? [
          setOffices(
            state,
            next,
            request.kind === 'add'
              ? 'write the wider list'
              : 'write the narrower list (one statement, so never broader at any moment)',
          ),
        ]
      : [],
  )
}

export interface ApplyResult {
  readonly applied: number
  readonly stoppedAt: number | null
  readonly detail: string
}

/**
 * Runs the statements in order and stops at the first that did not apply (a guard that no longer matches means somebody changed the
 * setting after the plan was read). What was applied before the stop is never broader than the plan's end state, so a stop is safe; the
 * operator re-reads the status and plans again.
 */
export const applyPlan = async (
  db: SqlExecutor,
  plan: Extract<SwitchPlan, { ok: true }>,
): Promise<ApplyResult> => {
  let applied = 0
  for (const [i, s] of plan.statements.entries()) {
    const r = await db.execute(s.sql)
    if (r.rows.length !== 1) {
      return {
        applied,
        stoppedAt: i,
        detail: `statement ${String(i + 1)} (${s.why}) matched nothing: the setting changed after it was read. Nothing further was written. Re-read the status and plan again.`,
      }
    }
    applied += 1
  }
  return { applied, stoppedAt: null, detail: `${String(applied)} statement(s) applied` }
}

/** Reads the two settings as stored JSON text (not as a driver's parsed value, which loses the difference between "all" and all). */
export const readStored = async (db: SqlExecutor): Promise<SwitchState> => {
  const r = await db.execute(
    `select key, value::text as v from public.system_config where key in ('${MASTER_KEY}', '${OFFICES_KEY}')`,
  )
  const rows = r.rows as { key: string; v: string }[]
  const get = (k: string): string | null => rows.find((x) => x.key === k)?.v ?? null
  return readState(get(MASTER_KEY), get(OFFICES_KEY))
}

/**
 * Planning the ledger's switches (docs/activity-ledger/MIGRATION-PLAN.md, stage D). Pure: it turns what an operator asked for, and what
 * the switches read now, into the exact SQL statements to run, in order, or into a refusal. It touches no database.
 *
 * Two settings decide whether the ledger is on for an office (app.activity_ledger_covers):
 *   activity.ledger_enabled   the MASTER switch and kill switch (true / false)
 *   activity.ledger_offices   optional allowlist: no row = every office, a JSON array of office ids = those offices
 *
 * The order is the safety. Narrowing is written BEFORE the master is turned on, so there is never a moment when the master is on and the
 * allowlist is not yet in force; turning off writes the master only, so the kill switch never depends on the allowlist being readable.
 */
export type SwitchRequest =
  | { readonly kind: 'canary'; readonly offices: readonly string[] }
  | { readonly kind: 'add'; readonly offices: readonly string[] }
  | { readonly kind: 'all' }
  | { readonly kind: 'off' }

export interface SwitchState {
  readonly master: boolean
  /** null: no allowlist row. */
  readonly allowlist: readonly string[] | null
}

export type SwitchPlan =
  | { readonly ok: true; readonly statements: readonly string[]; readonly note: string }
  | { readonly ok: false; readonly refusal: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const setting = (key: string, json: string, description: string): string =>
  `insert into public.system_config (key, value, description) values ('${key}', '${json}'::jsonb, '${description}') on conflict (key) do update set value = excluded.value, updated_at = app.now_utc()`

const list = (offices: readonly string[]): string => JSON.stringify([...new Set(offices)].sort())

export const planSwitch = (request: SwitchRequest, state: SwitchState): SwitchPlan => {
  if (request.kind === 'off') {
    return {
      ok: true,
      statements: [
        `update public.system_config set value = 'false'::jsonb, updated_at = app.now_utc() where key = 'activity.ledger_enabled'`,
      ],
      note: 'The master switch only. Nothing the ledger recorded is deleted; reads answer disabled and writers return null.',
    }
  }
  if (request.kind === 'all') {
    return {
      ok: true,
      statements: [
        `delete from public.system_config where key = 'activity.ledger_offices'`,
        `update public.system_config set value = 'true'::jsonb, updated_at = app.now_utc() where key = 'activity.ledger_enabled'`,
      ],
      note: 'EVERY office, the Sample and every future person included, as soon as the master is on.',
    }
  }
  const bad = request.offices.filter((o) => !UUID.test(o))
  if (request.offices.length === 0)
    return {
      ok: false,
      refusal:
        'name at least one office id; an empty list would turn the ledger on for no one, which is --off with extra steps',
    }
  if (bad.length > 0)
    return {
      ok: false,
      refusal: `${String(bad.length)} office id(s) are not UUIDs (the allowlist holds office ids, nothing else)`,
    }
  if (request.kind === 'add' && state.allowlist === null) {
    return {
      ok: false,
      refusal:
        'there is no allowlist (the ledger is on for every office, or off): --add narrows nothing. Use --canary <ids> to start one',
    }
  }
  const next =
    request.kind === 'add' ? [...(state.allowlist ?? []), ...request.offices] : request.offices
  return {
    ok: true,
    statements: [
      setting(
        'activity.ledger_offices',
        list(next),
        'Offices the activity ledger is on for, narrowing activity.ledger_enabled (1060 to 1062).',
      ),
      `update public.system_config set value = 'true'::jsonb, updated_at = app.now_utc() where key = 'activity.ledger_enabled'`,
    ],
    note: `The allowlist is written first, then the master is turned on: only ${String(new Set(next).size)} office(s) are covered.`,
  }
}

/** What the two settings read as, from their stored JSON: anything but a boolean true master is off, anything but an array of strings is no allowlist usable. */
export const readState = (
  master: unknown,
  allowlistRow: { value: unknown } | null,
): SwitchState => ({
  master: master === true,
  allowlist:
    allowlistRow === null
      ? null
      : Array.isArray(allowlistRow.value)
        ? allowlistRow.value.filter((x): x is string => typeof x === 'string')
        : [],
})

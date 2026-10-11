// biome-ignore-all format: dense inventory tables kept readable as written
/**
 * The release candidate carries every part of the unified activity ledger and its Team HQ screen, wired in the way the review assumes
 * (Phase 7 integration audit). This is an inventory, not a behaviour test: the behaviour is proved by the replica proofs and the browser
 * harness. It exists so that a merge, a rebase or a conflict resolution that silently drops a part turns this red.
 * Each assertion reads the integrated source, and the detector is shown a synthetic loss it must catch.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(p, 'utf8')
const m = (n: string): string => read(`migrations/${readdirSync('migrations').find((f) => f.startsWith(`${n}_`)) as string}`)
const m60 = m('1060')
const m61 = m('1061')
const m62 = m('1062')
const gateway = read('supabase/functions/hq-api/index.ts')
const shell = read('web/studio/bc/shell.js')

const has = (src: string, re: RegExp): boolean => re.test(src)

describe('the ledger is all there', () => {
  it('migrations 1060 to 1062 exist, once each, and nothing else is numbered in their range', () => {
    const files = readdirSync('migrations').filter((f) => /^106[0-2]_/.test(f))
    expect(files).toHaveLength(3)
    expect(readdirSync('migrations').filter((f) => /^105[4-9]_|^106[3-9]_/.test(f))).toEqual([])
  })
  it('the native store is append-only, office-scoped, idempotent and bounded', () => {
    expect(has(m60, /create table if not exists public\.activity_events/)).toBe(true)
    expect(has(m60, /Update, delete\s+and truncate are refused/)).toBe(true)
    expect(has(m60, /constraint activity_events_idempotent unique \(office_id, idempotency_key\)/)).toBe(true)
    expect(has(m60, /idempotency_key\s+text\s+not null check \(length\(idempotency_key\) between 8 and 200\)/)).toBe(true)
    expect(has(m60, /summary\s+text\s+not null check \(length\(summary\) between 1 and 300\)/)).toBe(true)
    expect(has(m60, /create trigger a1_office_write_once before update of office_id/)).toBe(true)
  })
  it('the read model projects the owning tables instead of storing a second copy', () => {
    for (const t of ['public.jobs', 'public.job_state_transitions', 'public.blockers', 'public.deliveries', 'public.outputs', 'public.routing_decisions', 'public.inbound_commands', 'public.job_impediments', 'public.inference_usage'])
      expect(m61.includes(t), t).toBe(true)
    expect(has(m61, /create or replace function app\.activity_read\(/)).toBe(true)
    expect(has(m61, /create or replace function app\.activity_chain\(/)).toBe(true)
    expect(has(m61, /create or replace function app\.activity_for_the_page\(/)).toBe(true)
    expect(has(m61, /create or replace function app\.activity_ledger_health\(/)).toBe(true)
  })
  it('activation fails closed: a master kill switch, a per-office list, the explicit all mode, one decision', () => {
    expect(has(m60, /'activity\.ledger_enabled', 'false'::jsonb/)).toBe(true)
    expect(has(m60, /create or replace function app\.activity_ledger_covers\(p_office uuid\)/)).toBe(true)
    expect(has(m60, /'\{"version": 1, "mode": "all"\}'::jsonb/)).toBe(true)
    expect(has(m60, /else false end/)).toBe(true)
    expect(has(m61, /app\.activity_ledger_covers\(p_office\)/)).toBe(true)
    expect(m60 + m61 + m62).not.toMatch(/insert into public\.system_config[^;]*activity\.ledger_offices/)
  })
  it('the external worker door has quotas, a lock, a closed type list and redaction', () => {
    expect(has(m60, /create or replace function app\.record_external_activity\(/)).toBe(true)
    expect(has(m60, /pg_advisory_xact_lock\(hashtextextended\('activity\.external'/)).toBe(true)
    expect(m60.match(/a\.actor_kind = 'external' and a\.occurred_at > /g)?.length).toBeGreaterThanOrEqual(3)
    expect(has(m60, /create or replace function app\.activity_external_metadata\(/)).toBe(true)
    expect(has(m60, /external_writable/)).toBe(true)
  })
  it('credential text is redacted in SQL and in TypeScript, and the strict writer redacts the summary', () => {
    expect(has(m60, /create or replace function app\.activity_redact\(/)).toBe(true)
    expect(has(m60, /left\(app\.activity_redact\(p_summary\), 300\)/)).toBe(true)
    expect(existsSync('src/text/secrets.ts')).toBe(true)
    expect(has(read('src/text/secrets.ts'), /redactSecrets|strict/i)).toBe(true)
  })
  it('approval and delivery provenance are read from the owning rows, never asserted', () => {
    expect(has(m61, /confirmed-by-person:%/)).toBe(true)
    expect(has(m61, /delivery\.succeeded/)).toBe(true)
    expect(has(m61, /approval\.granted/)).toBe(true)
    expect(has(m61, /approval\.answered/)).toBe(true)
  })
  it('the safe writer never raises into a job, and the worker and plan steps record best-effort', () => {
    expect(has(m60, /create or replace function app\.record_activity_safely\(/)).toBe(true)
    expect(existsSync('src/activity/record.ts')).toBe(true)
    expect(read('src/agents/perform.ts')).toMatch(/recordToolCall\(db, \{ \.\.\.toolCall, phase: 'requested' \}\)/)
    expect(has(m62, /activity|record_activity/)).toBe(true)
  })
  it('the operator tool and its planner exist and the npm script is registered', () => {
    for (const f of ['src/activity/switch.ts', 'src/activity/switch-cli.ts', 'scripts/ops/activity-switch.ts']) expect(existsSync(f), f).toBe(true)
    expect(read('package.json')).toMatch(/"activity:switch"/)
  })
  it('the gateway serves the four sections, office-scoped, with shape-checked parameters', () => {
    for (const s of ['activity_ledger', 'activity_feed', 'activity_chain', 'activity_health']) expect(gateway.includes(`${s}: {`), s).toBe(true)
    expect(has(gateway, /activity_chain: \{[\s\S]{0,200}requireOne: \['job', 'correlation'\]/)).toBe(true)
    expect(has(gateway, /param: 'before_at', arg: 'p_before_at', shape: 'time'/)).toBe(true)
  })
})

describe('the Team HQ screen is all there, and the older list is still the fallback', () => {
  const ui = read('web/studio/bc/activity.js')
  const model = read('web/studio/bc/activity-model.js')
  const css = read('web/studio/bc/activity.css')
  it('timeline, server-side views, paging, details, causal history, Needs attention, Happening now', () => {
    expect(ui).toMatch(/read\('activity_feed', undefined, q\)/)
    expect(ui).toMatch(/read\('activity_chain', undefined, \{ \.\.\.ask, visibility: 'user' \}\)/)
    expect(ui).toMatch(/Show older activity/)
    expect(ui).toMatch(/View related activity/)
    expect(ui).toMatch(/Waiting for you/)
    expect(ui).toMatch(/Happening now/)
    expect(model).toMatch(/status: 'completed'/)
    expect(model).toMatch(/severity: 'warning'/)
  })
  it('mobile rules, reduced motion and focus clearance are in the stylesheet', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)/)
    expect(css).toMatch(/prefers-reduced-motion: reduce/)
    expect(css).toMatch(/scroll-padding-top/)
  })
  it('the shell reaches it from two call sites and keeps the older page whole as the fallback', () => {
    expect(shell).toMatch(/activity\.render\('', \(\) => allActivity\(\)/)
    expect(shell).toMatch(/activity\.render\(p\.slug, \(\) => activitySurface\(p\)/)
    expect(shell).toMatch(/const activitySurface = \(p\) => \{/)
    expect(shell).toMatch(/const allActivity = \(\) => \{/)
    expect(read('web/studio/bc/wire.js')).toMatch(/activity\.wire\(root\)/)
    expect(read('web/studio/index.html')).toMatch(/\/bc\/activity\.css/)
  })
  it('main\'s own Activity behaviour survived the merge (the time range on the older project page)', () => {
    expect(shell).toMatch(/ACT_RANGES/)
    expect(shell).toMatch(/data-bc-actr/)
  })
  it('there is no second approval mechanism in the screen', () => {
    expect(ui).not.toMatch(/\bact\(|hq_answer_blocker|approval_answer/)
  })
})

describe('the inventory can fail (controls)', () => {
  it('a migration with the append-only sentence removed is caught', () => {
    expect(has(m60.replace(/Update, delete(\s+)and truncate are refused/g, 'Update, delete$1and truncate are allowed'), /Update, delete\s+and truncate are refused/)).toBe(false)
  })
  it('a shell without the hook is caught', () => {
    expect(has(shell.replace("activity.render('', ", "legacy('', "), /activity\.render\('', \(\) => allActivity\(\)/)).toBe(false)
  })
  it('a gateway without a section is caught', () => {
    expect(gateway.replace('activity_chain: {', 'activity_chain_x: {').includes('activity_chain: {')).toBe(false)
  })
})

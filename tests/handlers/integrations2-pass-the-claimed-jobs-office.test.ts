import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Multi-user P3, cluster i-integrations2. What the worker does to the outside world on an office's behalf is done in the
  office of the job it CLAIMED (or, for a sync round the duty already opened for one office, that office). The property
  is asserted on the FIRST ARGUMENT of every call to a converted function: it has to be derived from the claimed job (or
  be the office the round was opened for), never an id lifted from a payload, a request or a model answer, and never
  missing. A name appearing in a file proves nothing; the wired argument does.
*/
const root = new URL('../../', import.meta.url)
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8')

const CONVERTED = [
  'attach_file_to_document',
  'browser_note',
  'browser_session_expired',
  'calendar_link_clear',
  'calendar_link_set',
  'channel_authority',
  'consume_channel_authority',
  'drive_folders_to_check',
  'drive_reconcile',
  'drive_watch_checked',
  'fire_pending_signals',
  'google_revoke_finish',
  'mark_telegram_undeliverable',
  'notebook_allowance',
  'notebook_record_refusal',
  'notebook_record_spend',
  'reconcile_vanished',
  'record_browser_page',
  'record_channel_authority',
  'record_drive_document',
  'record_mcp_tools',
  'record_notebook_artifact',
  'record_slack_channel_rename',
  'record_slack_membership',
  'reminders_due',
  'reminders_sent',
  'task_delete_pushed',
  'task_push_failed',
  'task_pushed',
  'tasks_to_push',
  'undo_tasks_from_job',
] as const

/** The first argument of a call, with quotes and brackets respected. */
const firstArgument = (text: string, from: number): string => {
  let depth = 0
  let quote = ''
  let i = from
  for (; i < text.length; i += 1) {
    const ch = text[i] as string
    if (quote !== '') {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break
      depth -= 1
    } else if (ch === ',' && depth === 0) break
  }
  return text.slice(from, i).replace(/\s+/g, ' ').trim()
}

/** Calls to a converted function in a source text, with the first argument each passes. */
const callsIn = (text: string): { fn: string; first: string }[] => {
  const out: { fn: string; first: string }[] = []
  const re = new RegExp(`\\bapp\\.(${CONVERTED.join('|')})\\s*\\(`, 'g')
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    const lineStart = text.lastIndexOf('\n', at) + 1
    if (/^\s*(\*|\/\/|\/\*)/.test(text.slice(lineStart, at))) continue
    out.push({ fn: m[1] as string, first: firstArgument(text, at + m[0].length) })
  }
  return out
}

/** An office that comes from the claimed job, or from the office a round was opened for. */
const fromTheClaimedJob = (first: string): boolean =>
  /^app\.job_office\(/.test(first) ||
  /^\$\{(office|reportOffice)\}$/.test(first) ||
  /^\$\{lit\((opts|options)\.office\)\}::uuid$/.test(first) ||
  /^\$\{lit\(office\)\}::uuid$/.test(first) ||
  /^'\$\{String\(o\.office_id\)\}'::uuid$/.test(first)

const walk = (dir: string): string[] =>
  readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}${e.name}/`) : e.name.endsWith('.ts') ? [`${dir}${e.name}`] : [],
  )

describe('every worker call to a converted integration function names the claimed job’s office', () => {
  const files = walk('src/')
  const seen = files.flatMap((f) => callsIn(read(f)).map((c) => ({ ...c, f })))

  it('finds the calls (a check that found nothing proves nothing)', () => {
    expect(seen.length).toBeGreaterThan(40)
    for (const fn of ['drive_watch_checked', 'record_drive_document', 'notebook_record_spend']) {
      expect(seen.some((c) => c.fn === fn)).toBe(true)
    }
  })

  it('and every one of them passes an office taken from the job, not from anything the work was handed', () => {
    const bad = seen.filter((c) => !fromTheClaimedJob(c.first))
    expect(bad.map((c) => `${c.f}: ${c.fn}(${c.first.slice(0, 50)}`)).toEqual([])
  })

  it('CONTROL: the old shapes, and an id lifted from a payload, are refused by the same predicate', () => {
    const oldShape = callsIn(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the text under test is source code that holds placeholders
      'x = `select app.drive_watch_checked(${lit(f.attachment_id)}::uuid, null)`',
    )
    expect(oldShape.length).toBe(1)
    expect(fromTheClaimedJob(oldShape[0]?.first ?? '')).toBe(false)
    const lifted = callsIn(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the text under test is source code that holds placeholders
      "db.execute(`select app.tasks_to_push(${lit(payload.office)}::uuid, 'v')`)",
    )
    expect(fromTheClaimedJob(lifted[0]?.first ?? '')).toBe(false)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the text under test is source code that holds placeholders
    const good = callsIn('`select app.reminders_due(app.job_office(${lit(job.jobId)}::uuid))`')
    expect(fromTheClaimedJob(good[0]?.first ?? '')).toBe(true)
    // built in two pieces so the repository's own caller check does not read this control as a call
    const none = callsIn(`app.reminders_due${'()'}`)
    expect(none.length).toBe(1)
    expect(fromTheClaimedJob(none[0]?.first ?? 'x')).toBe(false)
  })

  it('where a handler holds the office in a variable, the variable is built from the claimed job', () => {
    expect(read('src/handlers/drive.ts')).toMatch(
      /const office = `app\.job_office\(\$\{lit\(job\.jobId\)\}::uuid\)`/,
    )
    expect(read('src/handlers/reminders.ts')).toMatch(
      /const office = `app\.job_office\('\$\{job\.jobId\.replace\(/,
    )
    // the NotebookLM meter takes its office from a type whose only constructor is a job id
    const meter = read('src/handlers/meter.ts')
    expect(meter).toMatch(/export const officeOfJob = \(jobId: string\): OfficeSql =>/)
    expect(meter).toMatch(/`app\.job_office\(\$\{lit\(jobId\)\}::uuid\)` as OfficeSql/)
    expect(meter).not.toMatch(/as OfficeSql[\s\S]*as OfficeSql/)
  })

  it('the calendar sync is opened for the office of the claimed job', () => {
    const h = read('src/handlers/calendar-tasks.ts')
    expect(h).toMatch(/app\.job_office\(\$\{lit\(job\.jobId\)\}::uuid\) as o/)
    expect(h).toMatch(/syncTasksToCalendar\(db, \{ office \}\)/)
    expect(h).toMatch(/planTasksForCalendar\(db, \{ office \}\)/)
  })

  it('the trigger scan loops the active offices and fires each one’s own signals', () => {
    const w = read('src/jobs/worker.ts')
    expect(w).toMatch(/for \(const o of signalOffices\)/)
    expect(w).toMatch(/app\.fire_pending_signals\('\$\{String\(o\.office_id\)\}'::uuid, 20\)/)
    expect(w).not.toMatch(/app\.fire_pending_signals\(20\)/)
  })

  it('the credential resolver is asked as the claimed job’s office, and as the system office only with no job', () => {
    const src = read('src/credentials/deployment.ts')
    expect(src).toMatch(
      /app\.deployment_credential\(app\.job_office\(\$\{lit\(job\)\}::uuid\), \$\{lit\(name\)\}, null, \$\{lit\(job\)\}::uuid, false\)/,
    )
    expect(src).toMatch(
      /job === null\s*\? `app\.deployment_credential\(\$\{DEPLOYMENT_OFFICE\}, \$\{lit\(name\)\}, null, null, true\)`/,
    )
  })

  it('a Google health row is written for the office whose work it is, and never over another office’s row', () => {
    const src = read('src/google/auth.ts')
    expect(src).toMatch(/where public\.connection_health\.office_id = excluded\.office_id/)
    expect(src).toMatch(/app\.job_office\(\$\{lit\(job\)\}::uuid\)/)
  })
})

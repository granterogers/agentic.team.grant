import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REACH } from '../../src/jobs/containment.ts'

/*
  Invariants 22 and 37, stated as a property instead of a hope.

  Every job kind that changes something in a third party's system (`reach: 'external'`) must either pass the
  canonical authorization (`mayWrite`, `governOutward`, `authorizeEffect`, `app.may_act`, the approval gate) or be
  NAMED below with the reason it does not. The list is the honest state of the office today: five kinds write
  outside without asking that time, each held by containment (runJob refuses harness and unknown-origin work) or by
  something stronger than a permission, with the reason named below. The four #389 duties are no longer on it:
  Grant decided how each behaves and each is now behind the one authorization (`governEffect`, 0640-0643):
  Vikunja create/update by the board's connection and delete by an exact question, Slack channels by the
  project's creation or an exact question, Notion import by the connected database, Slack token rotation by an
  exact question every time. This test makes it impossible for a sixth kind to join the five unnoticed, and
  impossible for a kind to stay on the list after it has been gated.
*/

const UNGATED: Record<string, string> = {
  'office.notion_adopt':
    'reads the workspace and records an attachment in our own database; a Notion write it is not, and it mints a connection only for a person (0641)',
  'office.notion_sync':
    "reads shared Notion pages into our documents; it writes nothing to Notion (the destination gate is on 'office.notion_import')",
  'google.revoke':
    "#390: starts only from Grant's press on Settings (a gateway action), never from a duty",
  'ci.dispatch':
    'governed by its own ledger: ci_reserve refuses past the monthly ceiling before anything is dispatched',
  'office.vault_export':
    'disabled unless Grant enables the export; door-gated and the destination is hard-wired',
}

/*
  A gate is a CALL WHOSE ANSWER IS CONSUMED, not a name that appears in the file (review V1: replacing every
  `mayStart(...)` with `{ ok: true }` left the earlier name-matching version green because the import line still
  named the module). So a handler is gated when it assigns the result of an awaited authorization call and then
  branches on it: `const start = await mayStart(...)` ... `if (!start.ok)`.
*/
const CALL =
  /\bconst\s+(\w+)\s*=\s*await\s+(?:mayWrite|mayStart|governOutward|governEffect|authorizeEffect|mayAct)\s*\(/g
const isGated = (text: string): boolean =>
  [...text.matchAll(CALL)].some((m) =>
    new RegExp(`if\\s*\\(\\s*!?\\s*${m[1]}\\.(?:ok|go|verdict)\\b`).test(text),
  )

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
// A mention in a comment is not a call (CLAUDE.md: a comment is not a call), so comments are removed first.
const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const files = walk('src').map((p) => ({ p, text: strip(readFileSync(p, 'utf8')) }))

const handlerFile = (kind: string) =>
  files.find(
    (f) =>
      !f.p.endsWith('containment.ts') &&
      !f.p.endsWith('office/pass.ts') &&
      (new RegExp(`kind: '${kind.replace('.', '\\.')}'`).test(f.text) ||
        (/office\.(provision|rename)_channels/.test(kind) && f.p.endsWith('handlers/channels.ts'))),
  )

const ungatedExternalKinds = (reach: Record<string, { reach: string }>): string[] =>
  Object.keys(reach)
    .filter((k) => reach[k]?.reach === 'external')
    .filter((k) => {
      const f = handlerFile(k)
      return f === undefined || !isGated(f.text)
    })
    .sort()

describe('every external kind is gated or named', () => {
  it('control: the detector finds the gated ones (a found-nothing guard)', () => {
    const external = Object.keys(REACH).filter((k) => REACH[k]?.reach === 'external')
    const gated = external.filter((k) => !ungatedExternalKinds(REACH).includes(k))
    expect(gated).toEqual(
      expect.arrayContaining([
        'notebook.generate',
        'google.write_calendar_tasks',
        'office.execute_plan',
        // The four #389 duties, gated by the final policy closure.
        'tasks.sync',
        'office.provision_channels',
        'office.rename_channels',
        'office.notion_import',
        'office.slack_rotate',
      ]),
    )
  })

  it('the ungated kinds are exactly the named ones, with a reason each', () => {
    expect(ungatedExternalKinds(REACH)).toEqual(Object.keys(UNGATED).sort())
    for (const [kind, why] of Object.entries(UNGATED)) expect(why.length, kind).toBeGreaterThan(20)
  })

  it('a gate whose answer is never consumed is not a gate (the review V1 sabotage)', () => {
    expect(isGated('const start = await mayStart(db, job, approval, "x")\nreturn run()')).toBe(
      false,
    )
    expect(
      isGated(
        'import { mayStart } from "./approval-gate.ts"\nconst start = { ok: true }\nif (!start.ok) return',
      ),
    ).toBe(false)
    expect(
      isGated(
        'const start = await mayStart(db, job, approval, "x")\nif (!start.ok) return refused()',
      ),
    ).toBe(true)
    expect(isGated('const gate = await governOutward(db, {})\nif (!gate.go) { return }')).toBe(true)
    // governEffect: the answer must be consumed, not merely awaited.
    expect(isGated('const d = await governEffect(db, job, {})\nreturn run()')).toBe(false)
    expect(isGated('const d = await governEffect(db, job, {})\nif (!d.ok) return refused()')).toBe(
      true,
    )
  })

  it('a new external kind with no gate and no entry is caught (the detector can fail)', () => {
    const withNew = { ...REACH, 'zz.new_external_write': { reach: 'external' } }
    expect(ungatedExternalKinds(withNew)).toContain('zz.new_external_write')
  })
})

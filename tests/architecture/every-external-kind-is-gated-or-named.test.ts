import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REACH } from '../../src/jobs/containment.ts'

/*
  Invariants 22 and 37, stated as a property instead of a hope.

  Every job kind that changes something in a third party's system (`reach: 'external'`) must either pass the
  canonical authorization (`mayWrite`, `governOutward`, `authorizeEffect`, `app.may_act`, the approval gate) or be
  NAMED below with the reason it does not. The list is the honest state of the office today: nine kinds write
  outside without asking that time, and each is held by containment (runJob refuses harness and unknown-origin
  work) rather than by a permission. Whether any of them should ask is Grant's decision (#389, #390, #393); this
  test does not make it, it makes it impossible for a tenth kind to join the nine unnoticed, and impossible for a
  kind to stay on the list after it has been gated.
*/

const UNGATED: Record<string, string> = {
  'office.notion_import':
    '#389/#393: writes to a database Grant attached; the attachment itself is ungated (#393)',
  'office.notion_adopt': '#389/#393: adopts pages already in an attached database',
  'office.notion_sync': "#389/#393: mirrors the office's own documents into an attached database",
  'google.revoke':
    "#390: starts only from Grant's press on Settings (a gateway action), never from a duty",
  'ci.dispatch':
    'governed by its own ledger: ci_reserve refuses past the monthly ceiling before anything is dispatched',
  'office.provision_channels':
    '#389: Slack channel creation for a project at least fifteen minutes old, once a day, conflict asks',
  'office.rename_channels': '#389: follows a rename Grant made on the dashboard',
  'office.slack_rotate':
    "#389: rotates the office's own Slack config token; a pre-rotation copy is stored first",
  'office.vault_export':
    'disabled unless Grant enables the export; door-gated and the destination is hard-wired',
  'tasks.sync': "#389: the task board is dormant; create/update/delete from the office's own tasks",
}

const DOOR =
  /\b(?:mayWrite|governOutward|authorizeEffect|mayAct)\b|authorize_effect|app\.may_act\(|approval-gate/

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
      return f === undefined || !DOOR.test(f.text)
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
      ]),
    )
  })

  it('the ungated kinds are exactly the named ones, with a reason each', () => {
    expect(ungatedExternalKinds(REACH)).toEqual(Object.keys(UNGATED).sort())
    for (const [kind, why] of Object.entries(UNGATED)) expect(why.length, kind).toBeGreaterThan(20)
  })

  it('a new external kind with no gate and no entry is caught (the detector can fail)', () => {
    const withNew = { ...REACH, 'zz.new_external_write': { reach: 'external' } }
    expect(ungatedExternalKinds(withNew)).toContain('zz.new_external_write')
  })
})

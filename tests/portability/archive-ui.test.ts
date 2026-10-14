/**
 * The archive controls are wired to the calls that do the work (#471, C2). These read the page source and assert the
 * CALL EXPRESSIONS, not the names: a name appearing in a file is not evidence that anything calls it. The browser journey
 * for the restore control is in .out/restore-ui.mjs (run by hand; see docs/release/PROGRESS-LEDGER.md).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('the archive download in Project Settings', () => {
  const settings = read('web/studio/project-settings.js')

  it('a button carries data-archive and is wired to the archive section for this project', () => {
    expect(settings).toContain('data-archive="${esc(p.id ?? \'\')}"')
    expect(settings).toContain("readFile('project_archive', p.id)")
  })

  it('the saved file is named from the slug, with the archive extension', () => {
    expect(settings).toContain('saveBlob(`${p.slug}-archive.zip`, blob)')
  })
})

describe('the restore control in the project menu', () => {
  const shell = read('web/studio/bc/shell.js')
  const wire = read('web/studio/bc/wire.js')
  const office = read('web/studio/office.js')

  it('the menu offers the restore only to a writer, as a button and a hidden file input', () => {
    expect(shell).toContain(
      '      mine\n        ? `<button type="button" role="menuitem" class="bcmenuitem bcmenurestore" data-bc-menu-restore>',
    )
    expect(shell).toContain('data-bc-restore-file')
    expect(shell).toContain('data-bc-restore-said')
  })

  it('choosing a file hands it to restoreArchive, and the button opens the picker', () => {
    expect(wire).toContain('const done = await restoreArchive(file)')
    expect(wire).toContain("root.querySelector('[data-bc-restore-file]')?.click()")
  })

  it('a success goes to the restored project, by its slug from the office', () => {
    expect(wire).toContain(
      'globalThis.location.assign(`/p/${encodeURIComponent(String(done.slug))}`)',
    )
  })

  it('the request sends the file as a ZIP body to the restore section, with the signed-in bearer token', () => {
    expect(office).toContain('`${API}?section=project_restore`')
    expect(office).toContain("'content-type': 'application/zip'")
    expect(office).toContain('body: file,')
    expect(office).toContain('Authorization: `Bearer ${await toPresent()}`')
  })

  it('a refusal shows the office sentence, and a sign-out is not treated as a restore', () => {
    expect(office).toContain(
      "if (began !== session.epoch()) throw new Error('You signed out before this arrived.')",
    )
    expect(office).toMatch(/if \(!r\.ok\) \{\s+const said = typeof answered\?\.error === 'string'/)
  })
})

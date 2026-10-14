/**
 * The archive controls are wired to the calls that do the work (#471, C2). These read the page source and assert the
 * CALL EXPRESSIONS, not the names: a name appearing in a file is not evidence that anything calls it. The browser journeys
 * for the export, the download and the restore are scripts/verify/archive-browser-local.ts (npm run verify:archive-browser).
 *
 * The strings below are the page's own source text, so each one is a template literal with its dollar sign escaped: the
 * test asserts the literal characters, and nothing is interpolated here.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('the archive download in Project Settings', () => {
  const settings = read('web/studio/project-settings.js')

  it('the download button has its own attribute and is wired to the archive section for this project', () => {
    expect(settings).toContain(`data-archive-download="\${esc(p.id ?? '')}"`)
    expect(settings).toContain("readFile('project_archive', p.id)")
    expect(settings).toContain("root.querySelectorAll('[data-archive-download]')")
  })

  it('no data-archive control carries the project id: that attribute belongs to Put it away alone', () => {
    // A button with data-archive is bound to the archive-the-project confirmation. A download button sharing it was
    // archiving the project when pressed (found by reading the handlers, 14 October 2026).
    expect(settings).not.toContain(`data-archive="\${esc(p.id`)
    expect(settings).toContain(`data-archive="\${esc(p.slug)}"`)
    expect(settings).toContain("root.querySelectorAll('[data-archive]')")
  })

  it('the saved file is named from the slug, with the archive extension', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the page's own source text, asserted literally
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

  it('choosing one file hands it to restoreArchive; several files go to the set path; the button opens the picker', () => {
    // The property, not the expression: a single archive that is not a set part still reaches restoreArchive, and every
    // other choice goes through the set path, which refuses an incomplete or mixed selection before any byte is sent.
    expect(wire).toContain('restoreArchive(picked[0])')
    expect(wire).toContain('restoreArchiveSet(orderedSetParts(picked)')
    expect(wire).toContain("root.querySelector('[data-bc-restore-file]')?.click()")
  })

  it('a success goes to the restored project, by its slug from the office', () => {
    expect(wire).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the page's own source text, asserted literally
      'globalThis.location.assign(`/p/${encodeURIComponent(String(done.slug))}`)',
    )
  })

  it('the request sends the file as a ZIP body to the restore section, with the signed-in bearer token', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the page's own source text, asserted literally
    expect(office).toContain('`${API}?section=project_restore`')
    expect(office).toContain("'content-type': 'application/zip'")
    expect(office).toContain('body: file,')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the page's own source text, asserted literally
    expect(office).toContain('Authorization: `Bearer ${await toPresent()}`')
  })

  it('a refusal shows the office sentence, and a sign-out is not treated as a restore', () => {
    expect(office).toContain(
      "if (began !== session.epoch()) throw new Error('You signed out before this arrived.')",
    )
    expect(office).toMatch(/if \(!r\.ok\) \{\s+const said = typeof answered\?\.error === 'string'/)
  })
})

/**
 * The ordinary things a person does to their own records have a control that performs them (#411, found as the Sample).
 *
 * `contacts.putAway` and the project rename existed with nothing pressing them: a contact added by mistake could never
 * leave, and Team HQ could not rename a project. A name appearing in a file is not evidence that anything calls it, so
 * these assert the WIRED CALL: the control is drawn with its attribute, and a handler for that attribute performs the
 * gateway action with the argument the office expects.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync('web/studio/bc/shell.js', 'utf8')
const wire = readFileSync('web/studio/bc/wire.js', 'utf8')
const settings = readFileSync('web/studio/project-settings.js', 'utf8')
const app = readFileSync('web/studio/app.js', 'utf8')

describe('removing a contact', () => {
  it('is drawn on the contact record', () => {
    expect(shell).toMatch(/button\('Remove contact', \{ 'data-bc-contact-away': esc\(key\) \}\)/)
  })
  it('is two presses and then puts the contact away through the office', () => {
    expect(wire).toMatch(/querySelectorAll\('\[data-bc-contact-away\]'\)/)
    expect(wire).toMatch(/Press again to remove/)
    expect(wire).toMatch(/contacts\.putAway\(ctx\.state\.project, key, true\)/)
  })
  it('puts away, never deletes (the gateway action is the reversible one)', () => {
    const contacts = readFileSync('web/studio/bc/contacts.js', 'utf8')
    expect(contacts).toMatch(/act\('contact_archive', \{ p_contact_id: key, p_put_away: away \}\)/)
  })
})

describe('renaming a project', () => {
  it('is drawn in Project settings with the current name in it', () => {
    expect(settings).toMatch(/data-projrename-form="\$\{esc\(p\.slug\)\}"/)
    expect(settings).toMatch(/data-projname[^>]*value="\$\{esc\(p\.name\)\}"/)
  })
  it('sends the slug and the new name, and reloads the office afterwards', () => {
    expect(settings).toMatch(
      /act\('rename_project', \{ p_slug: f\.dataset\.projrenameForm, p_name: name \}\)/,
    )
    expect(settings).toMatch(/if \(done\) await reload\?\.\(\)/)
  })
  it('is handed the page’s real reload, not the cheap redraw', () => {
    expect(app).toMatch(
      /projectSettings\.wire\(root, p, people, render, \(\) => \{ lookSheet\(p\) \}, refresh\)/,
    )
  })
})

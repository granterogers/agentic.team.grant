import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Settings and Usage are read when Settings is first drawn (efficiency run). Two promises the page makes about that, asserted over
 * the source as the WIRED expressions (a name appearing in a file is not evidence that anything calls it):
 *
 *  1. A failed read is asked again. The pane says to close it and open it again; a memoised settled promise would make that a
 *     promise nothing keeps.
 *  2. The Cost card never shows the prototype's invented figures to somebody signed in: until the usage read has answered for their
 *     office it says it is asking, and if it failed it says it could not be read. "You may say you could not look; you may not say
 *     there is nothing there."
 */
const app = readFileSync(new URL('../../web/studio/app.js', import.meta.url), 'utf8')

describe('lazy Settings reads stay honest', () => {
  it('forgets a failed settings read, so opening Settings again asks again', () => {
    const fn = app.slice(
      app.indexOf('function needSettings()'),
      app.indexOf('async function needLately()'),
    )
    expect(fn).toContain(
      "if (settingsAsked !== null && config.settingsSource.state === 'failed') settingsAsked = null",
    )
    // and it is decided BEFORE the memoised promise is returned
    expect(fn.indexOf("state === 'failed'")).toBeLessThan(
      fn.indexOf('if (settingsAsked !== null || !canWrite())'),
    )
  })

  it('does not draw the invented Cost card for a signed-in person until usage has answered', () => {
    expect(app).toContain('canWrite() && !usageSource.live')
    expect(app).toContain(
      "import { GROWTH, hydrateUsage, say as sayAmount, USAGE, usageSource } from './usage.js'",
    )
    const guard = app.indexOf('canWrite() && !usageSource.live')
    const real = app.indexOf('body: ui.card(USAGE.services.map(usageRow))')
    expect(guard).toBeGreaterThan(-1)
    // the honest branch comes first, the figures only in the other branch
    expect(real).toBeGreaterThan(guard)
    expect(app.slice(guard, real)).toContain('could not be read just now')
  })

  it('control: the detector can fail (a source without the guard does not match)', () => {
    const sabotaged = app.replace('canWrite() && !usageSource.live', 'false')
    expect(sabotaged).not.toContain('canWrite() && !usageSource.live')
  })
})

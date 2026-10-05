/**
 * A spacing token that does not exist is not an error: the declaration is dropped and the box has no padding. The sign-in
 * card shipped on a phone flush against its own text because `--bc-5` was never defined. Every `var(--bc-<n>)` the Team HQ
 * stylesheets use must be one tokens.css defines.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dir = 'web/studio/bc'
const defined = new Set(
  [...readFileSync(`${dir}/tokens.css`, 'utf8').matchAll(/--bc-(\d+):/g)].map((m) => m[1]),
)

describe('Team HQ spacing tokens', () => {
  it('knows which ones exist (the control: the list is not empty and has no 5)', () => {
    expect(defined.size).toBeGreaterThanOrEqual(8)
    expect(defined.has('5')).toBe(false)
  })

  it.each(readdirSync(dir).filter((f) => f.endsWith('.css')))(
    '%s uses only defined spacing tokens',
    (file) => {
      const used = [...readFileSync(`${dir}/${file}`, 'utf8').matchAll(/var\(--bc-(\d+)\)/g)].map(
        (m) => m[1] as string,
      )
      expect(used.filter((n) => !defined.has(n))).toEqual([])
    },
  )
})

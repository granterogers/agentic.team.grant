import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The stabilisation manifest pins each production step to the exact bytes of its migration and its rollback
 * (scripts/rollout/step.ts refuses a step whose file hash differs). Nothing in the gate compared them until the day of the rollout, so
 * an edit to a pending migration would have passed everything and failed at the production step. This does it in the gate.
 */
interface Step {
  migration: string
  migrationSha256: string
  rollback: string
  rollbackSha256: string
  objects: { sig: string; pre: string | null; post: string | null }[]
}
const manifest = JSON.parse(
  readFileSync('scripts/rollout/stabilisation/manifest.json', 'utf8'),
) as { steps: Record<string, Step> }
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')

describe('the stabilisation manifest matches the files it pins', () => {
  it('names exactly the four authorised steps, once each', () => {
    expect(Object.keys(manifest.steps).sort()).toEqual(['1023', '1025', '1027', '1028'])
  })

  for (const [step, s] of Object.entries(manifest.steps)) {
    it(`step ${step}: the migration and the rollback are the pinned bytes`, () => {
      expect(sha(s.migration), `${s.migration} changed after it was pinned`).toBe(s.migrationSha256)
      expect(sha(s.rollback), `${s.rollback} changed after it was pinned`).toBe(s.rollbackSha256)
    })

    it(`step ${step}: every object carries a pre and a post fingerprint (null only for an object the step adds or drops)`, () => {
      expect(s.objects.length).toBeGreaterThan(0)
      for (const o of s.objects) {
        for (const v of [o.pre, o.post]) expect(v === null || /^[0-9a-f]{32}$/.test(v)).toBe(true)
        expect(o.pre === o.post, `${o.sig}: pre equals post, so the step changes nothing`).toBe(
          false,
        )
      }
    })
  }

  it('control: the check can fail (a hash of different bytes does not equal the pin)', () => {
    const s = manifest.steps['1023']
    if (s === undefined) throw new Error('no 1023 step')
    const other = createHash('sha256').update('not the migration').digest('hex')
    expect(other).not.toBe(s.migrationSha256)
  })
})

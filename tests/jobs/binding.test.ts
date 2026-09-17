/**
 * What Grant approved is what runs (#263).
 *
 * The fingerprint is the whole mechanism, so these are about the ONE property
 * it must have: two actions that differ in anything material disagree, and two
 * that differ only in how they were written down agree. Each has its control,
 * because a hash that always differs refuses every resume and a hash that
 * always matches approves everything — and both look like a working check
 * from one side.
 */

import { describe, expect, it } from 'vitest'
import { fingerprint } from '../../src/jobs/checkpoint.ts'

describe('fingerprint', () => {
  it('is stable across property order, so a rebuilt object still matches', async () => {
    const a = await fingerprint({ body: 'the note', to: 'grant@example.com' })
    const b = await fingerprint({ to: 'grant@example.com', body: 'the note' })
    expect(a).toBe(b)
  })

  it('changes when the recipient changes', async () => {
    const a = await fingerprint({ body: 'the note', to: 'grant@example.com' })
    const b = await fingerprint({ body: 'the note', to: 'somebody@example.com' })
    expect(a).not.toBe(b)
  })

  it('changes when the body changes, however slightly', async () => {
    const a = await fingerprint({ body: 'the note', to: 'g@example.com' })
    const b = await fingerprint({ body: 'the note.', to: 'g@example.com' })
    expect(a).not.toBe(b)
  })

  it('sees into nested structure rather than stopping at the top level', async () => {
    const a = await fingerprint({ send: { attachments: ['a.pdf'], to: 'g@example.com' } })
    const b = await fingerprint({ send: { attachments: ['b.pdf'], to: 'g@example.com' } })
    expect(a).not.toBe(b)
  })

  it('distinguishes a missing field from an empty one', async () => {
    expect(await fingerprint({ to: 'g@example.com' })).not.toBe(
      await fingerprint({ cc: '', to: 'g@example.com' }),
    )
  })

  it('is a sha256, which is the shape the column accepts', async () => {
    expect(await fingerprint({ anything: 1 })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not collapse an array into a set — order is material', async () => {
    expect(await fingerprint(['a', 'b'])).not.toBe(await fingerprint(['b', 'a']))
  })
})

import { describe, expect, it, vi } from 'vitest'

// A browser module with no type declarations. Each case loads a fresh copy, because the loader asks only once per page.
const load = async () => {
  vi.resetModules()
  // @ts-expect-error - a browser module with no type declarations
  return (await import('../../web/studio/bc/drivefolder.js')) as {
    driveFolder: { connected: boolean | null }
    loadDriveFolder: (read: (a: string) => Promise<unknown>) => void
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('the Drive folder buttons follow whether Google is connected', () => {
  it('connected only when Google reports ok', async () => {
    const m = await load()
    m.loadDriveFolder(async () => ({ state: 'ok' }))
    await settle()
    expect(m.driveFolder.connected).toBe(true)
  })

  it('not connected for any other state, so the buttons stay off', async () => {
    for (const state of ['dead', 'unchecked', 'off', 'refused']) {
      const m = await load()
      m.loadDriveFolder(async () => ({ state }))
      await settle()
      expect(m.driveFolder.connected).toBe(false)
    }
  })

  it('not connected when the office does not answer', async () => {
    const m = await load()
    m.loadDriveFolder(async () => {
      throw new Error('no answer')
    })
    await settle()
    expect(m.driveFolder.connected).toBe(false)
  })

  it('asks the office once per page load', async () => {
    const m = await load()
    const read = vi.fn(async () => ({ state: 'ok' }))
    m.loadDriveFolder(read)
    m.loadDriveFolder(read)
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
  })
})

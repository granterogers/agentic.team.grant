/**
 * The storage sweep (owner-approved rule, 15 October 2026): an export cache and an uncommitted restore are removed after 24
 * hours; a committed restore, another office's data and an object whose age is unknown are never removed. Each rule is checked
 * on both sides, so a sweep that removes too much cannot pass, and one that removes nothing cannot pass either.
 */
import { describe, expect, it } from 'vitest'
import { memoryObjectStore } from '../../src/files/object-store.ts'
import { type StoredItem, SWEEP_AFTER_MS, sweepOffice } from '../../src/portability/set-store.ts'

const OFFICE_A = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const OFFICE_B = 'e13ce7a9-831b-49d7-83a5-2ede9c1a97d0'
const NOW = Date.parse('2026-10-15T12:00:00.000Z')
const OLD = NOW - SWEEP_AFTER_MS - 60 * 60 * 1000
const FRESH = NOW - 60 * 60 * 1000
const bytes = new TextEncoder().encode('x')

async function world(entries: { path: string; createdAt: number }[]) {
  const store = memoryObjectStore()
  for (const e of entries) await store.put(e.path, bytes, 'application/octet-stream')
  const items: StoredItem[] = entries
  return { store, items }
}

describe('the sweep: what is removed', () => {
  it('removes an old export cache (every object of it) and an old uncommitted restore, and nothing else', async () => {
    const { store, items } = await world([
      { path: `exports/${OFFICE_A}/c-old/set.json`, createdAt: OLD },
      { path: `exports/${OFFICE_A}/c-old/plan.json`, createdAt: OLD },
      { path: `exports/${OFFICE_A}/c-new/set.json`, createdAt: FRESH },
      { path: `restores/${OFFICE_A}/k-old/_index.json`, createdAt: OLD },
      { path: `restores/${OFFICE_A}/k-old/files/a.pdf`, createdAt: OLD },
      { path: `restores/${OFFICE_A}/k-done/_index.json`, createdAt: OLD },
      { path: `restores/${OFFICE_A}/k-done/_committed.json`, createdAt: OLD },
      { path: `restores/${OFFICE_A}/k-done/files/a.pdf`, createdAt: OLD },
      { path: `restores/${OFFICE_A}/k-fresh/_index.json`, createdAt: FRESH },
      { path: `exports/${OFFICE_B}/c-old/set.json`, createdAt: OLD },
      { path: `exports/${OFFICE_A}/c-unknown/set.json`, createdAt: Number.NaN },
    ])
    const out = await sweepOffice({ office: OFFICE_A, now: NOW, items, store })
    expect(out).toEqual({ removed: 4, exportCaches: 1, abandonedSets: 1 })
    // Removed: the old export and the old uncommitted restore.
    expect(await store.read(`exports/${OFFICE_A}/c-old/set.json`)).toBeNull()
    expect(await store.read(`exports/${OFFICE_A}/c-old/plan.json`)).toBeNull()
    expect(await store.read(`restores/${OFFICE_A}/k-old/_index.json`)).toBeNull()
    expect(await store.read(`restores/${OFFICE_A}/k-old/files/a.pdf`)).toBeNull()
  })

  it('keeps a committed restore, however old: its files belong to a project now', async () => {
    const { store, items } = await world([
      { path: `restores/${OFFICE_A}/k-done/_index.json`, createdAt: OLD },
      { path: `restores/${OFFICE_A}/k-done/_committed.json`, createdAt: OLD },
      { path: `restores/${OFFICE_A}/k-done/files/a.pdf`, createdAt: OLD },
    ])
    const out = await sweepOffice({ office: OFFICE_A, now: NOW, items, store })
    expect(out.removed).toBe(0)
    expect(await store.read(`restores/${OFFICE_A}/k-done/files/a.pdf`)).not.toBeNull()
  })

  it('keeps everything of another office, and every object whose age the store did not report', async () => {
    const { store, items } = await world([
      { path: `exports/${OFFICE_B}/c-old/set.json`, createdAt: OLD },
      { path: `exports/${OFFICE_A}/c-unknown/set.json`, createdAt: Number.NaN },
    ])
    const out = await sweepOffice({ office: OFFICE_A, now: NOW, items, store })
    expect(out.removed).toBe(0)
    expect(await store.read(`exports/${OFFICE_B}/c-old/set.json`)).not.toBeNull()
    expect(await store.read(`exports/${OFFICE_A}/c-unknown/set.json`)).not.toBeNull()
  })

  it('keeps a fresh export and a fresh restore', async () => {
    const { store, items } = await world([
      { path: `exports/${OFFICE_A}/c-new/set.json`, createdAt: FRESH },
      { path: `restores/${OFFICE_A}/k-fresh/_index.json`, createdAt: FRESH },
    ])
    const out = await sweepOffice({ office: OFFICE_A, now: NOW, items, store })
    expect(out.removed).toBe(0)
  })
})

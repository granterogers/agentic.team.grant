/**
 * The order in which a backup folder is emptied. The manifest goes first: a folder that still has its manifest reads as a
 * complete, verified backup even when some of its objects are gone, so an interrupted deletion must not leave one behind.
 * Each assertion is paired with a control that would fail if the order were reversed.
 */
import { describe, expect, it } from 'vitest'
import { deletionOrder } from '../../src/backup/runs.ts'

const folder = [
  'run-1/manifest.json.gz',
  'run-1/manifest.json.gz.sha256',
  'run-1/documents.json.gz',
  'run-1/documents.json.gz.sha256',
  'run-1/tasks.json.gz',
]

describe('deletionOrder', () => {
  it('removes the manifest before any data object', () => {
    const order = deletionOrder(folder)
    const firstData = order.findIndex((n) => !n.includes('/manifest.json.gz'))
    const lastManifest = order
      .map((n, i) => (n.includes('/manifest.json.gz') ? i : -1))
      .reduce((a, b) => Math.max(a, b), -1)
    expect(lastManifest).toBeLessThan(firstData)
  })

  it('removes every object exactly once', () => {
    expect([...deletionOrder(folder)].sort()).toEqual([...folder].sort())
  })

  it('keeps the data objects in the order they were listed (control: the sort is by manifest, not by name)', () => {
    const order = deletionOrder(folder)
    const data = order.filter((n) => !n.includes('/manifest.json.gz'))
    expect(data).toEqual([
      'run-1/documents.json.gz',
      'run-1/documents.json.gz.sha256',
      'run-1/tasks.json.gz',
    ])
  })

  it('handles an empty folder', () => {
    expect(deletionOrder([])).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import {
  type Manifest,
  type ObservedObject,
  tableKey,
  verifyArchive,
  verifyRestored,
} from '../../src/backup/manifest.ts'

const P = 'run-aaaaaaaa-0000-4000-8000-000000000000'
const sha = (c: string): string => c.repeat(64)
const good = (): { manifest: Manifest; observed: Map<string, ObservedObject> } => {
  const manifest: Manifest = {
    row_counts: { 'public.jobs': 3, 'app.config': 2 },
    tables: 2,
    rows: 5,
    objects: {
      [tableKey(P, 'public.jobs')]: { sha256: sha('a'), bytes: 100 },
      [tableKey(P, 'app.config')]: { sha256: sha('b'), bytes: 50 },
    },
    fingerprints: { 'public.jobs': '111', 'app.config': '222' },
    aux: {
      aux_version: 1,
      structure: { tables: 2 } as never,
      storage_objects: { ok: true, rows: [] },
    } as never,
  }
  const observed = new Map<string, ObservedObject>([
    [tableKey(P, 'public.jobs'), { sha256: sha('a'), bytes: 100 }],
    [tableKey(P, 'app.config'), { sha256: sha('b'), bytes: 50 }],
    [`${P}/manifest.json.gz`, { sha256: sha('c'), bytes: 9 }],
  ])
  return { manifest, observed }
}

describe('verifyArchive', () => {
  it('passes an archive whose objects are exactly what the manifest recorded', () => {
    const { manifest, observed } = good()
    const v = verifyArchive(manifest, P, observed)
    expect(v).toMatchObject({ ok: true, tables: 2, rows: 5, errors: [] })
  })

  it('refuses a missing object, naming the table', () => {
    const { manifest, observed } = good()
    observed.delete(tableKey(P, 'public.jobs'))
    const v = verifyArchive(manifest, P, observed)
    expect(v.ok).toBe(false)
    expect(v.errors.join()).toContain('public.jobs: its object')
  })

  it('refuses an object whose bytes are not the ones the manifest recorded (a corrupt or swapped part)', () => {
    const { manifest, observed } = good()
    observed.set(tableKey(P, 'app.config'), { sha256: sha('z'), bytes: 50 })
    const v = verifyArchive(manifest, P, observed)
    expect(v.ok).toBe(false)
    expect(v.errors.join()).toContain('app.config: its object does not match the checksum')
  })

  it('refuses a right checksum with a wrong size, and a count that is not a count', () => {
    const { manifest, observed } = good()
    observed.set(tableKey(P, 'app.config'), { sha256: sha('b'), bytes: 51 })
    expect(verifyArchive(manifest, P, observed).errors.join()).toContain('is 51 bytes')
    const bad = { ...manifest, row_counts: { 'public.jobs': -1, 'app.config': 2.5 } }
    const v = verifyArchive(bad, P, good().observed)
    expect(v.errors.filter((e) => e.includes('is not a count'))).toHaveLength(2)
  })

  it('refuses totals that do not add up', () => {
    const { manifest, observed } = good()
    expect(verifyArchive({ ...manifest, rows: 6 }, P, observed).errors.join()).toContain(
      'add up to 5',
    )
    expect(verifyArchive({ ...manifest, tables: 3 }, P, observed).errors.join()).toContain(
      'lists 2',
    )
    expect(
      verifyArchive({ ...manifest, row_counts: {}, rows: 0, tables: 0 }, P, observed).errors.join(),
    ).toContain('no tables')
  })

  it('warns, never silently passes, when the manifest cannot vouch (an old archive)', () => {
    const { observed } = good()
    const old: Manifest = { row_counts: { 'public.jobs': 3, 'app.config': 2 }, tables: 2, rows: 5 }
    const v = verifyArchive(old, P, observed)
    expect(v.ok).toBe(true)
    expect(v.warnings.join(' | ')).toContain('no object checksums')
    expect(v.warnings.join(' | ')).toContain('no content fingerprints')
    expect(v.warnings.join(' | ')).toContain('no auxiliary section')
  })

  it('reports an auxiliary section that could not be read when the backup ran, and an object the manifest does not list', () => {
    const { manifest, observed } = good()
    const aux = {
      ...(manifest.aux as object),
      auth_users: { ok: false, error: 'permission denied for table users', rows: [] },
    }
    observed.set(tableKey(P, 'public.late_table'), { sha256: sha('d'), bytes: 1 })
    const v = verifyArchive({ ...manifest, aux: aux as never }, P, observed)
    expect(v.ok).toBe(true)
    expect(v.warnings.join(' | ')).toContain('aux.auth_users could not be read')
    expect(v.warnings.join(' | ')).toContain('public.late_table')
  })
})

describe('verifyRestored', () => {
  const manifest: Manifest = {
    row_counts: { 'public.jobs': 3, 'public.empty': 0 },
    fingerprints: { 'public.jobs': '111' },
  }
  it('passes when counts and fingerprints match', () => {
    const v = verifyRestored(
      manifest,
      new Map([
        ['public.jobs', { rows: 3, fingerprint: '111' }],
        ['public.empty', { rows: 0, fingerprint: '0' }],
      ]),
    )
    expect(v).toMatchObject({ ok: true, rows: 3 })
  })
  it('fails a short table, a changed value of the same count, and a table that never came back', () => {
    const short = verifyRestored(
      manifest,
      new Map([
        ['public.jobs', { rows: 2, fingerprint: '111' }],
        ['public.empty', { rows: 0, fingerprint: '0' }],
      ]),
    )
    expect(short.errors.join()).toContain('restored 2 rows')
    const changed = verifyRestored(
      manifest,
      new Map([
        ['public.jobs', { rows: 3, fingerprint: '112' }],
        ['public.empty', { rows: 0, fingerprint: '0' }],
      ]),
    )
    expect(changed.errors.join()).toContain('content does not match')
    const missing = verifyRestored(
      manifest,
      new Map([['public.jobs', { rows: 3, fingerprint: '111' }]]),
    )
    expect(missing.errors.join()).toContain('public.empty: not restored')
  })
  it('warns, and does not pass silently, when there is nothing to compare content against', () => {
    const v = verifyRestored(
      { row_counts: { 'public.jobs': 3 } },
      new Map([['public.jobs', { rows: 3, fingerprint: '9' }]]),
    )
    expect(v.ok).toBe(true)
    expect(v.warnings.join()).toContain('no fingerprint to compare')
  })
})

/**
 * Which services a release deploys is computed, and the computation can fail (release preparation, 9 October 2026).
 *
 * The diff is pure, so it is proved on synthetic manifests with the controls that make it mean something: an identical
 * manifest deploys nothing, and each way a bundle can differ (a changed file, a new one, a removed one) deploys that
 * service and no other. The lists a flat upload uses are also pinned to the deploy scripts that send them, because a list
 * that drifted from its script would make "unchanged" mean nothing.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  diffManifests,
  LISTED_SERVICES,
  type Manifest,
} from '../../scripts/release/bundle-manifest.ts'

const base: Manifest = {
  worker: { 'src/a.ts': '1', 'src/b.ts': '2' },
  voice: { 'supabase/functions/voice/index.ts': '3' },
}
const copy = (m: Manifest): Manifest => JSON.parse(JSON.stringify(m)) as Manifest
const deploys = (a: Manifest, b: Manifest): string[] =>
  diffManifests(a, b)
    .filter((d) => d.deploy)
    .map((d) => d.service)

describe('what a release deploys', () => {
  it('nothing, when every bundle is byte-identical (the control)', () => {
    expect(deploys(base, copy(base))).toEqual([])
  })
  it('exactly the service whose file changed, was added or was removed', () => {
    const changed = copy(base)
    changed.worker = { ...changed.worker, 'src/a.ts': '9' }
    expect(deploys(base, changed)).toEqual(['worker'])

    const added = copy(base)
    added.voice = { ...added.voice, 'src/auth/new.ts': '4' }
    expect(deploys(base, added)).toEqual(['voice'])

    const removed = copy(base)
    removed.worker = { 'src/a.ts': '1' }
    expect(deploys(base, removed)).toEqual(['worker'])
  })
  it('a service the deployed side has never heard of is a deploy, and says it added everything', () => {
    const grown: Manifest = { ...copy(base), signin: { 'supabase/functions/signin/index.ts': '5' } }
    const d = diffManifests(base, grown).find((x) => x.service === 'signin')
    expect(d?.deploy).toBe(true)
    expect(d?.added).toEqual(['supabase/functions/signin/index.ts'])
  })
})

describe('the flat uploads are the files their scripts upload', () => {
  const script = (name: string) => readFileSync(`scripts/deploy/${name}`, 'utf8')
  it('telegram-webhook is its entrypoint and the adapter', () => {
    const s = script('edge-function.ts')
    for (const f of LISTED_SERVICES['telegram-webhook'] ?? []) expect(s).toContain(`'${f}'`)
  })
  it('slack-events is its entrypoint and three modules', () => {
    const s = script('slack-events.ts')
    for (const f of LISTED_SERVICES['slack-events'] ?? []) expect(s).toContain(`'${f}'`)
  })
  it('slack-oauth is its entrypoint and the oauth module', () => {
    const s = script('slack-oauth.ts')
    for (const f of LISTED_SERVICES['slack-oauth'] ?? []) expect(s).toContain(`'${f}'`)
  })
})

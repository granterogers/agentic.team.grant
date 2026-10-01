/**
 * The edge functions that share code ship their import graph (P1.1): a function uploaded as one file that imports
 * `src/auth/speaker.ts` deploys cleanly and fails on its first request, which is the failure this pins.
 */
import { describe, expect, it } from 'vitest'
import { bundleForm, walk } from '../../scripts/deploy/lib/bundle.ts'

const rel = (abs: string): string => abs.replace(`${process.cwd()}/`, '')

describe('deploy bundles', () => {
  it.each(['voice', 'voice-token'])('%s carries the shared speaker verifier', async (slug) => {
    const found = [...(await walk(`supabase/functions/${slug}/index.ts`)).keys()].map(rel)
    expect(found).toContain(`supabase/functions/${slug}/index.ts`)
    expect(found).toContain('src/auth/speaker.ts')
  })

  it('keeps the repository layout, so no import is rewritten', async () => {
    const { form, files } = await bundleForm(
      'voice-token',
      'supabase/functions/voice-token/index.ts',
    )
    expect(files).toBe(2)
    const names = form.getAll('file').map((f) => (f as File).name)
    expect(names).toContain('src/auth/speaker.ts')
    const meta = JSON.parse(String(form.get('metadata'))) as { entrypoint_path: string }
    expect(meta.entrypoint_path).toBe('supabase/functions/voice-token/index.ts')
  })

  it('the worker still walks its whole graph through the shared helper', async () => {
    const found = (await walk('supabase/functions/worker/index.ts')).size
    expect(found).toBeGreaterThan(100)
  })
})

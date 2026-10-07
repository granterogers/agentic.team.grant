/**
 * The hq-api gateway is uploaded from a hand-kept flat list. This pins that the list carries everything the entrypoint
 * imports: `deploy:hq-api` once omitted `preview.ts` (added by 0990) while `deploy:hq` carried it, so the cheaper
 * command would have uploaded a gateway that fails on its first request.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { closureProblems, localImports } from '../../scripts/deploy/lib/bundle.ts'
import { HQ_API_ENTRY, HQ_API_FILES } from '../../scripts/deploy/lib/hq-api-files.ts'

const sources = new Map(HQ_API_FILES.map((f) => [f.name, readFileSync(f.from, 'utf8')]))

describe('hq-api upload list', () => {
  it('is closed: every local import of every uploaded file is uploaded', () => {
    expect(closureProblems(sources)).toEqual([])
  })

  it('carries every file the entrypoint imports', () => {
    const wanted = localImports(sources.get(HQ_API_ENTRY) ?? '').map((s) => s.replace(/^\.\//, ''))
    expect(wanted).toEqual(expect.arrayContaining(['file-text.ts', 'oauth.ts', 'preview.ts']))
    for (const name of wanted) expect(HQ_API_FILES.map((f) => f.name)).toContain(name)
  })

  it('names its entrypoint, and each name is a flat file beside it', () => {
    expect(HQ_API_FILES.map((f) => f.name)).toContain(HQ_API_ENTRY)
    for (const f of HQ_API_FILES) expect(f.name.includes('/')).toBe(false)
  })

  it('the full deploy (deploy:hq) uploads the same sources, so the two cannot drift apart', () => {
    const hq = readFileSync('scripts/deploy/hq.ts', 'utf8')
    for (const f of HQ_API_FILES) expect(hq).toContain(`'${f.from}'`)
  })

  it('the hq-api-only deploy reads the list and checks it before sending anything', () => {
    const src = readFileSync('scripts/deploy/hq-function.ts', 'utf8')
    const check = src.indexOf('closureProblems(sources)')
    const send = src.indexOf('functions/deploy?slug=hq-api')
    expect(check).toBeGreaterThan(-1)
    expect(send).toBeGreaterThan(check)
    expect(src).toMatch(
      /for \(const f of HQ_API_FILES\) sources\.set\(f\.name, await readFile\(f\.from/,
    )
    expect(src).toMatch(/if \(problems\.length > 0\) \{[\s\S]*?process\.exit\(1\)/)
  })
})

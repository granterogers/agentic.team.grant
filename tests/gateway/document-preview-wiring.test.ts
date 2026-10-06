/**
 * The on-demand preview's gateway wiring (0990), read from the SOURCE of hq-api (a single Deno file).
 *
 * The decisions are in src/documents/preview.ts and the SQL; what only this file can get wrong is the seam: which office
 * the plan is asked for, who may reach Google, whether anything is stored, and what headers a streamed file carries. Each
 * property is a consumed call or a literal on the path, not a name that appears somewhere in the file.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
const a = source.indexOf("if (name === 'document_preview' || name === 'document_preview_file') {")
const b = source.indexOf('BROWSING GOOGLE DRIVE.', a)
const block = source.slice(a, b)

describe('hq-api document_preview', () => {
  it('has a block to read', () => {
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
  })

  it('asks the plan for the VERIFIED office, never one the request names', () => {
    expect(block).toMatch(/hq_document_preview_plan',\s*\{\s*p_office: office,/)
    expect(block).not.toMatch(/searchParams\.get\('(office|p_office)'\)/)
    expect(block).toMatch(/if \(office === null\) return json\(\{ error: 'no_office' \}, 403\)/)
  })

  it('records through the wrapper with the same verified office', () => {
    expect(block).toMatch(/hq_document_preview_record',\s*\{\s*p_office: office,/)
  })

  it('reaches Google only as the operator, and mints the token lazily inside the provider', () => {
    const provider = block.slice(
      block.indexOf('const providerFor'),
      block.indexOf('const extractText'),
    )
    expect(provider).toMatch(/isOperator\(principal\)/)
    expect(provider.indexOf('isOperator(principal)')).toBeLessThan(provider.indexOf('googleToken('))
    expect(provider).toContain("code: 'operator_required'")
    // Passed as a function that previewDocument calls only when Drive must be contacted.
    expect(block).toMatch(/previewDocument\(\{\s*plan,\s*provider: providerFor,/)
  })

  it('stores nothing: no Storage API, no signed URL, no file write on the preview path', () => {
    expect(block).not.toMatch(/storage\/v1/)
    expect(block).not.toMatch(/signPath|putFile|object\/files/)
  })

  it('serves a streamed file inline, uncached, sandboxed and nosniff', () => {
    expect(block).toContain("'cache-control': 'private, no-store'")
    expect(block).toContain("'x-content-type-options': 'nosniff'")
    expect(block).toContain("'content-security-policy': \"default-src 'none'; sandbox\"")
    expect(block).toMatch(/'content-disposition': `inline; filename=/)
  })

  it('validates the id and the project before using either', () => {
    expect(block).toMatch(/\.test\(id\)/)
    expect(block).toMatch(/\.test\(projectSlug\)/)
  })

  it('is uploaded beside the entrypoint by the deploy script', () => {
    const deploy = readFileSync('scripts/deploy/hq.ts', 'utf8')
    expect(deploy).toMatch(/readFile\('src\/documents\/preview\.ts'[\s\S]*?'preview\.ts'/)
    expect(source).toContain("from './preview.ts'")
  })

  it('src/documents/preview.ts imports nothing, so one file serves Deno and Node', () => {
    const src = readFileSync('src/documents/preview.ts', 'utf8')
    expect(src).not.toMatch(/^import\s/m)
  })
})

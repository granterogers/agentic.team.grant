import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Multi-user P3, cluster f. The browser and MCP-discovery handlers run for a CLAIMED job, and the office they act in is
  that job's: the budget is the job's office's, the stored session is looked up inside the job's office, and a
  provider named in the job's config is resolved among that office's providers (names are only unique per office).
  The properties are asserted on the wired expressions, not on the names appearing somewhere in the file.
*/
const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('integration handlers pass the claimed job, never a guess', () => {
  const gather = read('src/handlers/browser-gather.ts')
  const discover = read('src/handlers/mcp-discover.ts')

  it('the daily browsing budget is asked for the job office', () => {
    expect(gather).toMatch(
      /app\.browser_budget\(app\.job_office\(\$\{lit\(job\.jobId\)\}::uuid\)\)/,
    )
    expect(gather).not.toMatch(/app\.browser_budget\(\)/)
  })

  it('the stored session is read only through a project of the job office', () => {
    expect(gather).toMatch(/sp\.office_id = app\.job_office\(\$\{lit\(job\.jobId\)\}::uuid\)/)
  })

  it('a provider is resolved by name inside the job office, not across offices', () => {
    expect(discover).toMatch(
      /p\.office_id = app\.job_office\(\$\{lit\(job\.jobId\)\}::uuid\)\s+and p\.name = \$\{lit\(name\)\}/,
    )
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  The final policy, as properties of the source beside the behavioural proofs (scripts/isolated/policy-*.ts). Each
  assertion is on the WIRED expression, never on a name that merely appears in a file, and each was proved by
  breaking the thing it names.
*/
const read = (p: string) => readFileSync(p, 'utf8')
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const gateway = strip(read('supabase/functions/hq-api/index.ts'))

describe('the connection and creation acts carry a verified person, never a claimed one', () => {
  it('attach and the Vikunja connection carry the principal for every credential, and the database refuses a non-person', () => {
    expect(gateway).toMatch(/attach: \{ fn: 'hq_attach', required: \[[^\]]*\], by: 'p_by' \}/)
    expect(gateway).toMatch(/vikunja_connect: \{[^}]*by: 'p_by'/)
  })

  it('project creation carries the principal ONLY for a person, so the office key records nothing', () => {
    expect(gateway).toMatch(/create_project: \{[^}]*personBy: 'p_by'/)
    expect(gateway).not.toMatch(/create_project: \{[^}]*\bby: 'p_by'/)
    // The wired expression: a client-sent value is deleted, and only a person's verified principal is written.
    expect(gateway).toMatch(
      /delete args\[action\.personBy\]\s*if \(kind === 'person' && principal !== null && principal !== ''\) \{\s*args\[action\.personBy\] = principal/,
    )
  })
})

describe('the four duties ask through the one gate, and nothing opens it with a flag', () => {
  const handlers: [string, string][] = [
    ['src/handlers/tasks-sync.ts', 'tasks.sync'],
    ['src/handlers/channels.ts', 'office.provision_channels'],
    ['src/handlers/notion-import.ts', 'office.notion_import'],
    ['src/handlers/slack-rotation.ts', 'office.slack_rotate'],
  ]
  it.each(handlers)('%s consumes the answer of governEffect', (file) => {
    const t = strip(read(file))
    const m = [...t.matchAll(/\bconst\s+(\w+)\s*=\s*await\s+governEffect\s*\(/g)]
    expect(m.length, file).toBeGreaterThan(0)
    expect(
      m.some((x) => new RegExp(`if\\s*\\(\\s*!?\\s*${x[1]}\\.ok\\b`).test(t)),
      file,
    ).toBe(true)
  })

  it('the sync duty builds its own gate and never uses the open one reserved for the engine suite', () => {
    const t = strip(read('src/handlers/tasks-sync.ts'))
    expect(t).not.toContain('permitEverything')
    expect(t).toMatch(/await syncOnce\(\s*db,[\s\S]*?\bgate,\s*\{ office \},?\s*\)/)
    expect(t).toMatch(/tool: 'task\.board\.delete'/)
    expect(t).toMatch(/tool: 'task\.board\.write'/)
  })

  it('rotation asks for each expiry, never a standing yes', () => {
    const t = strip(read('src/handlers/slack-rotation.ts'))
    expect(t).toMatch(/tool: 'slack\.rotate',\s*material: \{\s*expiresAt:\s*expiresAt === 0/)
    expect(t).not.toMatch(/standingOption|standingTool/)
  })

  it('a question raised by the gate offers no standing option', () => {
    const t = strip(read('src/handlers/approval-gate.ts'))
    const start = t.indexOf('export const governEffect')
    expect(start).toBeGreaterThan(0)
    expect(t.slice(start)).not.toMatch(/standingOption|standingTool/)
  })
})

describe('retrieval widens only through the office, and says where each source is from', () => {
  it('the answering path and the research step use the project-first function', () => {
    expect(strip(read('src/handlers/instruction.ts'))).toMatch(/await retrieveAcrossOffice\(/)
    expect(strip(read('src/agents/perform.ts'))).toMatch(/await retrieveAcrossOffice\(/)
  })
  it('the search for another project goes through app.sibling_projects and never builds its own list', () => {
    const t = strip(read('src/knowledge/retrieval.ts'))
    expect(t).toMatch(/app\.sibling_projects\(/)
    expect(t).toMatch(/app\.projects_named_in\(/)
    expect(t).not.toMatch(/from public\.projects/)
  })
})

describe('review findings: the delete budget never strands an approval (1 October)', () => {
  const src = readFileSync('src/handlers/tasks-sync.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  it('the budget turns off raising a question, not the check', () => {
    expect(src).toMatch(/noQuestion:\s*asked\s*>=\s*MAX_DELETE_QUESTIONS_PER_ROUND/)
    expect(src).not.toMatch(/if\s*\(\s*asked\s*>=\s*MAX_DELETE_QUESTIONS_PER_ROUND\s*\)\s*return/)
  })
  it('the adopt handler mints no authority', () => {
    const adopt = readFileSync('src/handlers/notion-adopt.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(adopt).not.toMatch(/record_destination_authority/)
  })
})

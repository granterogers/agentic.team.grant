/**
 * Who the office is talking to (#404). The words an office composes name the person its job is for.
 *
 *   1. the identity helper: only a person office with a usable name is named; everything else is neutral, never Grant
 *   2. the composed wording, driven under Grant's office and under a second person's: Grant's keeps "Grant", the second
 *      person's never contains the literal name
 *   3. a ratchet over the product source: no NEW string literal names Grant outside the reviewed list, found with the
 *      TypeScript parser (a comment or a regex is not wording), with a positive control that proves it can fail
 */
import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { literalsNamingGrant } from '../../scripts/p5/grant-literals.ts'
import { guidanceBrief } from '../../src/agents/guidance.ts'
import { provenanceNote } from '../../src/agents/provenance.ts'
import { metadataProblems } from '../../src/agents/quality.ts'
import {
  currentPerson,
  NOBODY,
  personFrom,
  personOfJob,
  withPerson,
} from '../../src/office/person.ts'

const GRANT = personFrom('person', 'Grant')
const SECOND = personFrom('person', 'Priya Raman')

/** The detector: does wording addressed to this person name Grant? A word boundary, so "grant permission" is not a hit. */
const namesGrant = (text: string): boolean => /\bGrant(?:['’]s)?\b/.test(text)

const lessons = {
  lessons: [
    {
      body: 'Always give your information in the form of clear bullet points.',
      scope: 'staff',
      observations: 2,
      stated: true,
    },
  ],
  skills: [],
} as unknown as Parameters<typeof guidanceBrief>[0]

/** Every piece of composed wording reachable as a pure call, as one string per sentence. */
const wording = (): string[] => {
  const problem = (extra: Record<string, unknown>): string[] =>
    metadataProblems({
      confidence: 'high',
      evidence: 'verified',
      sources: ['job:a'],
      contradictions: null,
      ...extra,
    }).map((p) => p.problem)
  return [
    guidanceBrief(lessons),
    provenanceNote(),
    ...problem({ body: "That's the middle tier you told me.", hadHistory: false }),
    ...problem({ body: 'I will send them an email this afternoon.' }),
    ...problem({
      body: 'We need to call task.create. Attempt task.create.',
      toolNames: ['task.create'],
    }),
  ]
}

describe('the person an office is for', () => {
  it('names a person office by its name', () => {
    expect(GRANT).toMatchObject({ name: 'Grant', possessive: "Grant's", named: true })
    expect(SECOND).toMatchObject({ name: 'Priya Raman', possessive: "Priya Raman's", named: true })
  })

  it.each([
    ['the test office', 'test', 'Test principal and quarantine'],
    ['the deployment office', 'system', 'The deployment'],
    ['a sample office', 'sample', 'Sample'],
    ['no kind at all', null, 'Grant'],
    ['a person office with no name', 'person', ''],
    ['a person office whose name is only invisible characters', 'person', '​  \t'],
  ])('is neutral for %s, and never Grant', (_label, kind, name) => {
    const p = personFrom(kind, name)
    expect(p.named).toBe(false)
    expect(p.name).toBe(NOBODY.name)
    expect(namesGrant(p.name)).toBe(false)
  })

  it('cleans a name that goes into a prompt: control characters and invisible characters become spaces, length is bounded', () => {
    expect(personFrom('person', 'Priya​\u0007 Raman ').name).toBe('Priya Raman')
    expect(personFrom('person', 'x'.repeat(500)).name.length).toBe(80)
  })

  it('is neutral with no job in scope (an operator tool, a unit test) and follows the scope when there is one', async () => {
    expect(currentPerson()).toBe(NOBODY)
    await withPerson(SECOND, async () => {
      await Promise.resolve()
      expect(currentPerson().name).toBe('Priya Raman')
    })
    expect(currentPerson()).toBe(NOBODY)
  })

  it('keeps two jobs running at once apart', async () => {
    const seen: string[] = []
    await Promise.all([
      withPerson(GRANT, async () => {
        await new Promise((ok) => setTimeout(ok, 5))
        seen.push(`a:${currentPerson().name}`)
      }),
      withPerson(SECOND, async () => {
        seen.push(`b:${currentPerson().name}`)
        await new Promise((ok) => setTimeout(ok, 10))
        seen.push(`b2:${currentPerson().name}`)
      }),
    ])
    expect(seen.sort()).toEqual(['a:Grant', 'b2:Priya Raman', 'b:Priya Raman'])
  })

  it('asks the database through the JOB, and a failure or a missing office is neutral (never a default name)', async () => {
    const db = (rows: unknown[] | Error) =>
      ({
        execute: async (sql: string) => {
          expect(sql).toContain("app.job_office('2b62f5b2-01b0-496c-90c9-f7c0f44a7466'::uuid)")
          if (rows instanceof Error) throw rows
          return { rows }
        },
      }) as never
    const job = '2b62f5b2-01b0-496c-90c9-f7c0f44a7466'
    expect((await personOfJob(db([{ kind: 'person', name: 'Grant' }]), job)).name).toBe('Grant')
    expect((await personOfJob(db([{ kind: 'person', name: 'Priya Raman' }]), job)).name).toBe(
      'Priya Raman',
    )
    expect(await personOfJob(db([]), job)).toBe(NOBODY)
    expect(await personOfJob(db(new Error('no_office')), job)).toBe(NOBODY)
    expect(await personOfJob(db([]), "x'; drop table jobs; --")).toBe(NOBODY)
  })
})

describe('the wording an office composes, under two people', () => {
  it('has something to check (a control: the builders really produce sentences)', () => {
    const sentences = withPerson(GRANT, wording)
    expect(sentences.length).toBeGreaterThanOrEqual(5)
    expect(sentences.every((s) => s.length > 20)).toBe(true)
  })

  it("under Grant's office it still addresses Grant", () => {
    const sentences = withPerson(GRANT, wording)
    expect(sentences.some((s) => /\bGrant\b/.test(s))).toBe(true)
  })

  it("under a second person's office it addresses them and never calls them Grant", () => {
    const sentences = withPerson(SECOND, wording)
    expect(sentences.filter(namesGrant)).toEqual([])
    expect(sentences.some((s) => s.includes('Priya Raman'))).toBe(true)
  })

  it('and under a non-person office it says neither', () => {
    const sentences = withPerson(personFrom('test', 'Test principal and quarantine'), wording)
    expect(sentences.filter(namesGrant)).toEqual([])
    expect(sentences.some((s) => s.includes('the person you work for'))).toBe(true)
  })

  it('CONTROL: the detector goes red on a sentence that does name Grant, and green once it is restored', () => {
    const leaky = (who: string): string[] => [
      ...withPerson(SECOND, wording),
      `Put on ${who}'s list: "x"`,
    ]
    expect(leaky('Grant').filter(namesGrant)).toHaveLength(1)
    expect(leaky('Priya Raman').filter(namesGrant)).toHaveLength(0)
    // a verb is not a name
    expect(namesGrant('Grant this? The agent gets the tool from its next job onwards.')).toBe(true)
    expect(namesGrant('we grant permission to the tool')).toBe(false)
  })
})

describe('the source: no new string literal names Grant', () => {
  /**
   * REVIEWED, and why each stays. A string literal in these files names Grant on purpose:
   *   - telegram/pager.ts, handlers/vault-export.ts, handlers/slack-rotation.ts: the DEPLOYMENT OPERATOR's own channel and
   *     credentials (the pager, the vault export, the Slack app's tokens) - operator-only behaviour, not a person's words;
   *   - simulation/*: the harness, which writes to Grant's real office and says so;
   *   - notion/capabilities.ts: notes in a static table of what Notion can do, recording that the operator makes
   *     databases by hand;
   * (SQL comments carried inside template literals are removed by the scanner: they are not wording.)
   */
  const REVIEWED: Record<string, number> = {
    'src/telegram/pager.ts': 2,
    'src/handlers/vault-export.ts': 2,
    'src/handlers/slack-rotation.ts': 2,
    'src/simulation/canonical.ts': 1,
    'src/simulation/provision.ts': 1,
    'src/notion/capabilities.ts': 2,
  }

  const scan = (): Record<string, number> => {
    const counts: Record<string, number> = {}
    for (const f of globSync('src/**/*.ts')) {
      const n = literalsNamingGrant(f, readFileSync(f, 'utf8')).length
      if (n > 0) counts[f] = n
    }
    return counts
  }

  it('finds the reviewed ones (a scan that finds nothing proves nothing)', () => {
    const counts = scan()
    expect(Object.keys(counts).length).toBeGreaterThan(0)
    for (const [file, n] of Object.entries(REVIEWED)) expect(counts[file], file).toBe(n)
  })

  it('finds no other file, and no more in a reviewed one', () => {
    const counts = scan()
    const extra = Object.entries(counts).filter(([f, n]) => n > (REVIEWED[f] ?? 0))
    expect(extra).toEqual([])
  })

  it('CONTROL: the scanner sees a string and a template that name Grant, and ignores a comment, a regex and a verb', () => {
    const src = [
      "const a = 'Put on Grant\\'s list'",
      'const b = `Write ${x} to Grant`',
      '// Grant said this',
      '/* Grant: "this" */',
      'const re = /Grant/',
      "const verb = 'we grant permission to the tool'",
    ].join('\n')
    expect(literalsNamingGrant('x.ts', src).map((h) => h.line)).toEqual([1, 2])
  })
})

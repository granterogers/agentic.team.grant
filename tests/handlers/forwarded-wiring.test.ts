import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Forwarded words are content, not intent (Run 5, 0624; the link door, #393). The three writers that used to read
  a forwarded message as his instruction each carry the wired condition - asserted as the expression that gates the
  write, because a name appearing in a file is not evidence that anything calls it.
*/
const src = readFileSync(new URL('../../src/handlers/instruction.ts', import.meta.url), 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('a forwarded turn does not write as if he had said it', () => {
  it('asks whether the turn was forwarded from the durable record, and a failed ask reads false', () => {
    expect(code).toMatch(/select app\.job_forwarded\(\$\{lit\(job\.jobId\)\}::uuid\) as f/)
    expect(code).toMatch(/\.catch\(\(\) => false\)/)
  })
  it('a marked standing rule found in it is OFFERED, never stored', () => {
    expect(code).toMatch(/teaching\.kind === 'lesson' && \(!teaching\.marked \|\| forwarded\)/)
  })
  it('a personal task found in it is not filed', () => {
    expect(code).toMatch(/subOf !== null \|\| forwarded/)
  })
  it('a link in it is not attached or filed', () => {
    expect(code).toMatch(/isBranch \|\| forwarded \? null : entitled\.link\(turn\.kept\)/)
  })
})

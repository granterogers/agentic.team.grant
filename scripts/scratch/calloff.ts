import * as c from '../../src/agents/calloff.ts'
import { readCorrection } from '../../src/agents/correction.ts'

const fn = (c as Record<string, unknown>).callsItOff as (s: string) => unknown
for (const s of process.argv.slice(2))
  console.log(
    JSON.stringify(s),
    'callsItOff=',
    JSON.stringify(fn?.(s)),
    'correction=',
    readCorrection(s, true)?.rule ?? null,
  )

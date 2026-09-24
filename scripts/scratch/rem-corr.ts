import { readCorrection } from '../../src/agents/correction.ts'

for (const s of process.argv.slice(2))
  console.log(JSON.stringify(s), '=>', readCorrection(s, true)?.rule ?? null)

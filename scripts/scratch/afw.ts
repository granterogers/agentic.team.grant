import { clauses } from '../../src/agents/clauses.ts'
import { asksForWork, readRequest } from '../../src/agents/request.ts'

for (const s of process.argv.slice(2))
  console.log(
    asksForWork(s, clauses),
    JSON.stringify(readRequest(s, clauses).map((r) => [r.mood, r.text.slice(0, 50)])),
    s.slice(0, 70),
  )

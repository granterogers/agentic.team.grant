import { personalTaskChange, personalTaskRequest } from '../../src/agents/mine.ts'

const now = new Date('2026-09-24T12:00:00Z')
for (const s of process.argv.slice(2)) {
  console.log(
    JSON.stringify(s),
    '\n  req',
    JSON.stringify(personalTaskRequest(s, now)),
    '\n  chg',
    JSON.stringify(personalTaskChange(s, now)),
  )
}

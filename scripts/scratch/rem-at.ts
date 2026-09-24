import { personalTaskRequest } from '../../src/agents/mine.ts'

const now = new Date('2026-09-24T10:00:00Z') // 13:00 in Athens
for (const s of process.argv.slice(2))
  console.log(JSON.stringify(s), JSON.stringify(personalTaskRequest(s, now)))

import { classifyIntent } from '../../src/agents/intent.ts'
import { personalTaskRequest } from '../../src/agents/mine.ts'
import { readRetraction } from '../../src/agents/retraction.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

const now = new Date('2026-09-24T10:00:00Z')
for (const s of process.argv.slice(2)) {
  const p = personalTaskRequest(s, now)
  const t = taskRequest(s, classifyIntent(s), s)
  const r = readRetraction(s)
  console.log(
    `${JSON.stringify(s)}\n   personal=${JSON.stringify(p)}\n   project=${JSON.stringify(t)}\n   retraction.kept=${JSON.stringify(r?.kept ?? null)}`,
  )
}

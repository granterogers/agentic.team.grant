import { cleanDictation } from '../../src/agents/dictation.ts'
import { classifyIntent } from '../../src/agents/intent.ts'
import { personalTaskRequest } from '../../src/agents/mine.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

const now = new Date('2026-09-24T10:00:00Z')
for (const raw of process.argv.slice(2)) {
  const s = cleanDictation(raw)
  console.log(
    `${JSON.stringify(raw)}\n   clean=${JSON.stringify(s)}\n   personal=${JSON.stringify(personalTaskRequest(s, now))}\n   project=${JSON.stringify(taskRequest(s, classifyIntent(s), s))}`,
  )
}

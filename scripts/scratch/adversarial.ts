import { callsItOff } from '../../src/agents/calloff.ts'
import { cleanDictation } from '../../src/agents/dictation.ts'
import { classifyIntent } from '../../src/agents/intent.ts'
import {
  personalTaskChange,
  personalTaskRequest,
  subtaskRequest,
  taskStateChange,
} from '../../src/agents/mine.ts'
import { spokenAnswer } from '../../src/agents/spoken-answer.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

const now = new Date('2026-09-24T10:00:00Z')
const lines = process.argv.slice(2)
for (const raw of lines) {
  const s = cleanDictation(raw)
  const fired: string[] = []
  if (personalTaskRequest(s, now)) fired.push(`personal:${personalTaskRequest(s, now)?.title}`)
  if (taskRequest(s, classifyIntent(s), s))
    fired.push(`project:${taskRequest(s, classifyIntent(s), s)?.title}`)
  if (personalTaskChange(s, now)) fired.push('change')
  if (taskStateChange(s)) fired.push(`state:${JSON.stringify(taskStateChange(s))}`)
  if (subtaskRequest(s)) fired.push('subtask')
  if (callsItOff(s)) fired.push('calloff')
  if (spokenAnswer(s)) fired.push(`answer:${spokenAnswer(s)}`)
  console.log(
    `${fired.length === 0 ? '  --' : '  !!'} ${JSON.stringify(raw)}  ${fired.join(' | ')}`,
  )
}

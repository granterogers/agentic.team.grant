import { classifyIntent } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

const whole = process.argv[2] ?? ''
for (const s of process.argv.slice(3))
  console.log(JSON.stringify(s), JSON.stringify(taskRequest(s, classifyIntent(s), whole)))

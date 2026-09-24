import { taskRequest } from '../../src/agents/tasks.ts'
import { classifyIntent } from '../../src/agents/intent.ts'
for (const s of process.argv.slice(2)) console.log(JSON.stringify(s), JSON.stringify(classifyIntent(s)), JSON.stringify(taskRequest(s, classifyIntent(s))))

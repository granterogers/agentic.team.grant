import { taskStateChange } from '../../src/agents/mine.ts'

for (const s of process.argv.slice(2))
  console.log(JSON.stringify(s), JSON.stringify(taskStateChange(s)))

import { personalTaskRequest } from '../../src/agents/mine.ts'
import { resolveElliptical } from '../../src/agents/tasks.ts'
const t = 'Perfect, and another for the caterers.'
const r = resolveElliptical(t, `${t} Add a task to chase the printers. Thanks. Also one to book the minibus.`)
console.log(r, JSON.stringify(personalTaskRequest(r)))

import { personalTaskRequest } from '../../src/agents/mine.ts'
import { readRetraction } from '../../src/agents/retraction.ts'

const said =
  'Create a task for me and the um... No actually, you know what? Scan the entirety of the Legacy Coaching Project and create appropriate tasks for me to review'

console.log('RAW title      ->', JSON.stringify(personalTaskRequest(said)?.title ?? null))
const r = readRetraction(said)
console.log('readRetraction ->', JSON.stringify(r))
if (r !== null) {
  console.log('kept title     ->', JSON.stringify(personalTaskRequest(r.kept)?.title ?? null))
}

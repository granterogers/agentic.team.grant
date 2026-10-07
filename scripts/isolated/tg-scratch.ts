import { speaker } from '../../src/handlers/instruction.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'tg_b')
for (const t of process.argv.slice(3)) {
  const w = await speaker(db, null, t, null, null, [], null)
  console.log(JSON.stringify(t), '->', w.slug, JSON.stringify(w.convened), w.reason.slice(0, 80))
}
process.exit(0)

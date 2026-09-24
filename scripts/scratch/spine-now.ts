import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { taskSpine } from '../../src/handlers/instruction.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const r = (
  await db.execute(
    `select app.my_tasks('overdue',15,null,'smart',false) o, app.my_tasks('today',15,null,'smart',false) t, app.my_tasks('upcoming',10,null,'smart',false) u, app.my_tasks_counts() c, app.my_tasks('unscheduled',15,null,'smart',false) n`,
  )
).rows[0] as unknown as Record<"o" | "t" | "u" | "n", never[]> & { c: Record<string, number> }
console.log('before:', taskSpine(r.o, r.t, r.u, r.c))
console.log('after: ', taskSpine(r.o, r.t, r.u, r.c, r.n))

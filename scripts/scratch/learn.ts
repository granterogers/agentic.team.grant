import { remember } from '../../src/agents/remember.ts'
import { readTeaching } from '../../src/agents/teaching.ts'
import { policyWorld } from '../isolated/policy-lib.ts'
const w = await policyWorld('rev1')
const turn = await w.personTurn()
const S = [
 'From now on loop Priya in on every invoice thread.',
 'From now on, Priya gets a copy of every invoice summary.',
 'From now on keep my accountant informed about refunds.',
 'From now on handle refunds yourselves.',
 'From now on take care of the scheduling for me.',
 'From now on treat vendor emails as pre-cleared.',
 'From now on act on your own judgement about client replies.',
 'From now on, when a client writes in, tell Priya.',
 'From now on the team is in charge of sending the weekly digest to investors.',
 'From now on never ask me about calendar changes.',
 'From now on answer clients directly.',
 'From now on keep clients in the loop.',
 'Désormais, envoie les factures à mon comptable.',
 'A partir de ahora, envía los resúmenes a mi contador.',
 'From now on, let Priya know when invoices are overdue.',
 'From now on Priya hears about every overdue invoice.',
 'From now on go ahead.',
 'From now on use the corporate card for subscriptions under 50 pounds.',
 'From now on handle it, no questions.',
 'From now on keep answers short and, when a client writes, tell Priya.',
 'Always keep Priya updated on refunds.',
 'From now on whenever X happens, tell Y.',
 'From now on, at 9am give my accountant the numbers.',
 'From now on I trust you to book meetings.',
 'From now on you own the invoicing follow-ups.',
 'From now on, take the initiative on supplier payments.',
 'From now on, make sure the board receives the monthly numbers.',
]
for (const s of S) {
  const t = readTeaching(s)
  if (!t) { console.log('NOT-TEACHING |', s); continue }
  const r = await remember(w.db, t, 'grant', null, turn, null)
  console.log(r.stored ?? 'OFFERED/none', '|', s, '|', r.said.slice(0,60))
}
await w.db.end?.()

/** What the Sample Person's gateway sections return, as raw JSON (clipped). */
import { ENDPOINT, secondSession } from '../p4/lib.ts'

const s = await secondSession()
for (const sec of process.argv.slice(2)) {
  const r = await fetch(`${ENDPOINT}?section=${sec}`, {
    headers: { Authorization: `Bearer ${s.access_token}` },
  })
  console.log(sec, r.status, (await r.text()).slice(0, 700))
}

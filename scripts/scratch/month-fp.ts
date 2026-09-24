import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const LOOSE =
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/gi
const REAL =
  /^(?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:\s+\d{1,2})?$/i
for (const scope of ['not', '']) {
  const rows = (
    await db.execute(`select o.body from outputs o where ${scope} app.harness_job(o.job_id)`)
  ).rows as { body: string }[]
  let fp = 0
  const ex: string[] = []
  for (const r of rows)
    for (const m of String(r.body).matchAll(LOOSE))
      if (!REAL.test(m[0].trim())) {
        fp++
        if (ex.length < 8) ex.push(m[0])
      }
  const imp = (
    await db.execute(
      `select count(*)::int n from job_impediments i where i.detail like 'the text gives a specific time or date%' and ${scope} app.harness_job(i.job_id)`,
    )
  ).rows[0] as { n: number }
  console.log(
    `${scope === 'not' ? 'REAL' : 'HARNESS'}: ${rows.length} answers, ${fp} non-month matches e.g. ${JSON.stringify(ex)}; date refusals recorded: ${imp.n}`,
  )
}

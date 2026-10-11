/**
 * The two redactors agree (migration 1060): app.activity_redact in SQL and redactSecrets in src/text/secrets.ts.
 *
 *   npx tsx scripts/isolated/activity-redaction.ts <replica-db>
 *
 * A redaction list that lives in two places is wrong in at least one of them, and the failure is silent. The same table of cases is
 * put through both; any difference in WHAT is redacted fails the run. The SQL carries one family the TypeScript does not (a PEM
 * private-key header), so that case is checked on its own, and the neighbours of every family (a near miss that must NOT be
 * redacted) are in the table so over-eagerness is as visible as a leak.
 *
 * No credential literal sits in this file: every specimen is built from pieces, as the rule at the top of secrets.ts asks.
 */
import { redactSecrets, secretFamilies } from '../../src/text/secrets.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'ledger')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const sqlRedact = async (t: string): Promise<string> =>
  String(
    ((await db.execute(`select app.activity_redact(${lit(t)}) as v`)).rows[0] as { v: string }).v,
  )

const j = (...p: string[]) => p.join('')
const A = 'abcdefghijklmnopqrstuvwxyz'
const cases: { name: string; text: string; redacted: boolean }[] = [
  { name: 'slack bot token', text: `see ${j('xo', 'xb-123456789012-', A)} here`, redacted: true },
  { name: 'openai style key', text: `key ${j('s', 'k-', 'proj-', A, '0123')}`, redacted: true },
  { name: 'openrouter key', text: `key ${j('s', 'k-', 'or-v1-', A, '0123')}`, redacted: true },
  { name: 'supabase pat', text: `pat ${j('sb', 'p_', '0123456789abcdef0123')}`, redacted: true },
  { name: 'notion token', text: `n ${j('nt', 'n_', '0123456789abcdefghij')}`, redacted: true },
  {
    name: 'google api key',
    text: `g ${j('AI', 'za', 'SyA-0123456789abcdefghijk')}`,
    redacted: true,
  },
  {
    name: 'google refresh token',
    text: `r ${j('1/', '/', '0123456789abcdefghijklmn')}`,
    redacted: true,
  },
  {
    name: 'github token',
    text: `gh ${j('gh', 'p_', '0123456789abcdefghijklmnop')}`,
    redacted: true,
  },
  {
    name: 'telegram bot token',
    text: `t ${j('1234567890', ':', 'AAEhBP0abcdefghijklmnopqrstuvwxyz1234')}`,
    redacted: true,
  },
  {
    name: 'jwt',
    text: `j ${j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', A)}`,
    redacted: true,
  },
  { name: 'aws key id', text: `a ${j('AK', 'IA', 'ABCDEFGHIJKLMNOP')}`, redacted: true },
  {
    name: 'bearer header',
    text: `Authorization: Bearer ${j('abcd', 'efgh1234ijkl')}`,
    redacted: true,
  },
  {
    name: 'basic header, scheme kept',
    text: `Authorization: Basic ${j('dXNlcjpw', 'YXNzd29yZA==')}`,
    redacted: true,
  },
  { name: 'long opaque run with a digit', text: `h ${'a1'.repeat(25)}`, redacted: true },
  {
    name: 'plain prose',
    text: 'The quarterly review covers pricing, onboarding and support.',
    redacted: false,
  },
  { name: 'a uuid', text: 'job 5b6f0c1e-1234-4abc-9def-0123456789ab finished', redacted: false },
  { name: 'a short code', text: 'error_code channel_not_found on attempt 2', redacted: false },
  { name: 'money and times', text: 'It cost 63.50 and ran from 09:30 to 10:15', redacted: false },
  {
    name: 'a long word with no digit',
    text: 'internationalisationinternationalisationinternationalisation',
    redacted: false,
  },
  {
    name: 'bearer in prose without a token',
    text: 'The bearer of this letter is welcome',
    redacted: false,
  },
]

let exit = 1
try {
  for (const c of cases) {
    const ts = redactSecrets(c.text)
    const sql = await sqlRedact(c.text)
    const tsChanged = ts !== c.text
    const sqlChanged = sql !== c.text
    // The markers name the family and the families are the same words in both, so equality is expected, not just agreement on "changed".
    check(
      `${c.name}: both redact it, or both leave it alone`,
      tsChanged === c.redacted && sqlChanged === c.redacted,
      `ts ${tsChanged}, sql ${sqlChanged}, expected ${c.redacted}`,
    )
    if (c.redacted)
      check(
        `${c.name}: the stored text names a family and holds no credential`,
        secretFamilies(sql).length === 0 && sql.includes('[redacted:'),
        sql.slice(0, 70),
      )
  }
  const sameMarkers: { name: string; ts: string; sql: string }[] = []
  for (const c of cases.filter((x) => x.redacted))
    sameMarkers.push({ name: c.name, ts: redactSecrets(c.text), sql: await sqlRedact(c.text) })
  const differ = sameMarkers.filter((m) => m.ts !== m.sql)
  check(
    'parity: every redacted case is byte-identical between the two',
    differ.length === 0,
    differ.length === 0
      ? `${sameMarkers.length} identical`
      : `differ: ${differ.map((d) => d.name).join(', ')}`,
  )
  const pem = await sqlRedact(`-----BEGIN ${'RSA '}PRIVATE KEY-----\nMIIE...`)
  check(
    'sql only: a PEM private key header is redacted',
    pem.includes('[redacted:private-key]') && !pem.includes('BEGIN RSA'),
    pem.slice(0, 50),
  )
  check(
    'safe on empty and null',
    (await sqlRedact('')) === '' &&
      String(
        ((await db.execute('select app.activity_redact(null) as v')).rows[0] as { v: unknown }).v,
      ) === 'null',
    'empty -> empty, null -> null',
  )
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)

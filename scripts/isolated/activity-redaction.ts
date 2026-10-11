// biome-ignore-all format: a dense proof table kept readable as written
/**
 * The two strict redactors agree, and what they do and do not catch is asserted (migration 1060): `app.activity_redact` in SQL and
 * `redactStrict` in src/text/secrets.ts.
 *
 *   npx tsx scripts/isolated/activity-redaction.ts <replica-db>
 *
 * A redaction list in two places is wrong in at least one of them and the failure is silent, so one table of cases goes through both and
 * any difference in WHAT is redacted fails the run, then a seeded fuzz of 400 mixed strings (credential-shaped fragments, benign words,
 * separators, newlines) must agree byte for byte. The table holds, beside every family, the neighbour that must NOT be redacted
 * (over-eagerness is as visible as a leak), the harmless figures the ledger exists to carry (token counts, durations), the evasions that
 * ARE handled (zero-width splits, full-width letters, unusual spaces, URL credentials, assignments) and the ones that are NOT, pinned as
 * limitations so the documentation cannot claim more than the code does. Timing is bounded.
 *
 * Every specimen is synthetic and built from pieces so no credential-shaped literal sits in this file, and nothing below prints a
 * specimen: a failure names the case and the family, never the text.
 */
import { redactSecrets, redactStrict, strictFamilies } from '../../src/text/secrets.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'ledger')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const sqlRedact = async (t: string): Promise<string> =>
  String(((await db.execute(`select app.activity_redact(${lit(t)}) as v`)).rows[0] as { v: string }).v)

const j = (...p: string[]) => p.join('')
const A = 'abcdefghijklmnopqrstuvwxyz'
const ZW = '\u{200B}'

// secret: the value that must not survive (null = nothing secret); redacted: whether the text should change
const cases: { name: string; text: string; secret: string | null; redacted: boolean; limitation?: boolean }[] = [
  { name: 'slack bot token', secret: j('xo', 'xb-123456789012-', A), text: '', redacted: true },
  { name: 'openai style key', secret: j('s', 'k-', 'proj-', A, '0123'), text: '', redacted: true },
  { name: 'openrouter key', secret: j('s', 'k-', 'or-v1-', A, '0123'), text: '', redacted: true },
  { name: 'supabase pat', secret: j('sb', 'p_', '0123456789abcdef0123'), text: '', redacted: true },
  { name: 'notion token', secret: j('nt', 'n_', '0123456789abcdefghij'), text: '', redacted: true },
  { name: 'google api key', secret: j('AI', 'za', 'SyA-0123456789abcdefghijk'), text: '', redacted: true },
  { name: 'google refresh token', secret: j('1/', '/', '0123456789abcdefghijklmn'), text: '', redacted: true },
  { name: 'github token', secret: j('gh', 'p_', '0123456789abcdefghijklmnop'), text: '', redacted: true },
  { name: 'telegram bot token', secret: j('1234567890', ':', 'AAEhBP0abcdefghijklmnopqrstuvwxyz1234'), text: '', redacted: true },
  { name: 'jwt', secret: j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', A), text: '', redacted: true },
  { name: 'aws key id', secret: j('AK', 'IA', 'ABCDEFGHIJKLMNOP'), text: '', redacted: true },
  { name: 'stripe live key', secret: j('s', 'k_live_', '0123456789abcdefABCD'), text: '', redacted: true },
  { name: 'stripe webhook secret', secret: j('wh', 'sec_', '0123456789abcdefABCD'), text: '', redacted: true },
  { name: 'sendgrid key', secret: j('S', 'G.', 'abcdefghijklmnop0123', '.', 'qrstuvwxyz0123456789'), text: '', redacted: true },
  { name: 'npm token', secret: j('np', 'm_', 'abcdefghij0123456789ABCDEFGHIJ'), text: '', redacted: true },
  { name: 'hugging face token', secret: j('h', 'f_', 'abcdefghij0123456789ABCDEFGHIJ'), text: '', redacted: true },
  { name: 'gitlab token', secret: j('gl', 'pat-', 'abcdefghij0123456789'), text: '', redacted: true },
  { name: 'google access token', secret: j('ya', '29.', 'abcdefghij0123456789ABC'), text: '', redacted: true },
  { name: 'twilio sid', secret: j('A', 'C', '0123456789abcdef0123456789abcdef'), text: '', redacted: true },
  { name: 'slack webhook url', secret: j('hooks.slack.com/', 'services/', 'T0123ABCD/B0123ABCD/abcdefghij'), text: '', redacted: true },
  { name: 'url user and password', secret: 'Zx9-synthetic-pw', text: '', redacted: true },
  { name: 'url with a token as the user', secret: 'abcdefghij0123456789abcd', text: '', redacted: true },
  { name: 'password assignment', secret: 'hunter2synthetic', text: '', redacted: true },
  { name: 'quoted password with spaces', secret: 'two words synthetic', text: '', redacted: true },
  { name: 'client secret with a colon', secret: 'abc123synthetic', text: '', redacted: true },
  { name: 'api key in single quotes', secret: 'kv-synthetic-123', text: '', redacted: true },
  { name: 'upper-case key name', secret: 'SYNTHETICVALUE', text: '', redacted: true },
  { name: 'access token in a query string', secret: 'synthetic123', text: '', redacted: true },
  { name: 'Token:value with no space', secret: 'abcdefgh1234', text: '', redacted: true },
  { name: 'authorization header with a colon and no space', secret: 'abcdefgh1234', text: '', redacted: true },
  { name: 'bearer header', secret: j('abcd', 'efgh1234ijkl'), text: '', redacted: true },
  { name: 'basic header, scheme kept', secret: j('dXNlcjpw', 'YXNzd29yZA=='), text: '', redacted: true },
  { name: 'long opaque run with a digit', secret: 'a1'.repeat(25), text: '', redacted: true },
  { name: 'mixed-case run a vendor never listed', secret: 'Zx9Kq2LmN8pQ4rT7vW1yB3cD5', text: '', redacted: true },
  { name: 'pem key with its body', secret: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC', text: '', redacted: true },
  { name: 'slack token split by a zero-width space', secret: j('xo', 'xb-1234', ZW, '56789012-', A), text: '', redacted: true },
  { name: 'key and value in full-width letters', secret: 'swordfishsynthetic', text: '', redacted: true },
  { name: 'assignment with non-breaking spaces', secret: 'nbspsynthetic1', text: '', redacted: true },
  { name: 'token split by a soft hyphen and a bidi mark', secret: j('gh', 'p_', '0123456789\u{AD}', 'abcdefghij\u{202E}klmnop'), text: '', redacted: true },
  // the second review: a credential name with a prefix, and a token split by an invisible character outside the first list
  { name: 'env style DB_PASSWORD', secret: 'abcdef123synthetic', text: '', redacted: true },
  { name: 'env style GITHUB_TOKEN', secret: 'abcd1234xsynthetic', text: '', redacted: true },
  { name: 'camel case adminPassword', secret: 'abcd1234xsynthetic', text: '', redacted: true },
  { name: 'PGPASSWORD with no separator', secret: 'abcdef123456synth', text: '', redacted: true },
  { name: 'prefixed user_password with a colon', secret: 'abcd1234xsynthetic', text: '', redacted: true },
  { name: 'openai key split by a tag character', secret: j('s', 'k-', '\u{E0001}', 'abcdefghijklmnop1234'), text: '', redacted: true },
  { name: 'github token split by a variation selector', secret: j('gh', 'p_', '0123456789\u{E0100}', 'abcdefghijklmnop'), text: '', redacted: true },
  { name: 'slack token split by an Arabic format character', secret: j('xo', 'xb-123456', '\u{600}', '789012-', A), text: '', redacted: true },
  // the neighbours, and the harmless figures the ledger carries
  { name: 'plain prose', secret: null, text: 'The quarterly review covers pricing, onboarding and support.', redacted: false },
  { name: 'a uuid', secret: null, text: 'job 5b6f0c1e-1234-4abc-9def-0123456789ab finished', redacted: false },
  { name: 'a short code', secret: null, text: 'error_code channel_not_found on attempt 2', redacted: false },
  { name: 'money and times', secret: null, text: 'It cost 63.50 and ran from 09:30 to 10:15', redacted: false },
  { name: 'a long word with no digit', secret: null, text: 'internationalisationinternationalisationinternationalisation', redacted: false },
  { name: 'bearer in prose without a token', secret: null, text: 'The bearer of this letter is welcome', redacted: false },
  { name: 'token counts and limits are not credentials', secret: null, text: 'prompt_tokens=5000 completion_tokens: 200 max_tokens=1024 total tokens used: 5200 token_budget=100000', redacted: false },
  { name: 'durations and usage figures', secret: null, text: 'duration=250ms latency_ms: 88 cost_usd=0.0021 attempt=2 count=14', redacted: false },
  { name: 'the word password in prose', secret: null, text: 'A password reset email was sent and the secret of success is practice', redacted: false },
  { name: 'a score that starts with pass', secret: null, text: 'pass: 3 of 4 checks, session 4 of 5', redacted: false },
  { name: 'a url without credentials', secret: null, text: 'see https://example.com/docs/page2 and ssh://deploy@example.com/x/y.git', redacted: false },
  { name: 'a date range and an id', secret: null, text: 'from 2026-10-11T08:00:00Z to 2026-10-11T09:00:00Z', redacted: false },
  { name: 'a file path with a version', secret: null, text: 'see docs/activity-ledger/MIGRATION-PLAN.md and src/text/secrets.ts', redacted: false },
  // limitations, pinned: NOT caught, and the documentation says so
  { name: 'LIMITATION a short secret in prose', secret: null, text: 'the code word is swordfish and the pin is 4831', redacted: false, limitation: true },
  { name: 'LIMITATION a credential-named key in look-alike letters', secret: null, text: 'pаssword=swordfishsynthetic', redacted: false, limitation: true },
  { name: 'LIMITATION a secret that is percent-encoded', secret: null, text: '%70assword=swordfishsynthetic', redacted: false, limitation: true },
  { name: 'LIMITATION a secret that is base64 of a short value', secret: null, text: 'dGhlIHBhc3N3b3Jk', redacted: false, limitation: true },
]
// fill in the text of the secret-bearing cases from their pieces (kept out of the table so each literal is one place)
const wrap: Record<string, (s: string) => string> = {
  'url user and password': (s) => `connect ${'postgres'}ql://app:${s}@db.internal:5432/x now`,
  'url with a token as the user': (s) => `clone https://${s}@github.com/x/y.git`,
  'password assignment': (s) => `config password=${s} retries=3`,
  'quoted password with spaces': (s) => `{"password": "${s}", "user": "x"}`,
  'client secret with a colon': (s) => `client_secret: ${s} done`,
  'api key in single quotes': (s) => `api_key = '${s}' and more`,
  'upper-case key name': (s) => `PASSWORD=${s}`,
  'env style DB_PASSWORD': (s) => `DB_PASSWORD=${s} next`,
  'env style GITHUB_TOKEN': (s) => `GITHUB_TOKEN=${s}`,
  'camel case adminPassword': (s) => `adminPassword=${s}`,
  'PGPASSWORD with no separator': (s) => `PGPASSWORD=${s}`,
  'prefixed user_password with a colon': (s) => `user_password: ${s}`,
  'access token in a query string': (s) => `GET /x?access_token=${s}&page=2`,
  'Token:value with no space': (s) => `Token:${s}`,
  'authorization header with a colon and no space': (s) => `Authorization:Bearer ${s}`,
  'bearer header': (s) => `Authorization: Bearer ${s}`,
  'basic header, scheme kept': (s) => `Authorization: Basic ${s}`,
  'pem key with its body': (s) => `-----BEGIN ${'RSA '}PRIVATE KEY-----\n${s}\n${s}\n-----END ${'RSA '}PRIVATE KEY----- after`,
  'key and value in full-width letters': (s) => `ｐａｓｓｗｏｒｄ＝${s}`,
  'assignment with non-breaking spaces': (s) => `password = ${s}`,
}
for (const c of cases) if (c.secret !== null && c.text === '') c.text = (wrap[c.name] ?? ((s: string) => `see ${s} here`))(c.secret)

let exit = 1
try {
  const rows: { name: string; ts: string; sql: string }[] = []
  for (const c of cases) {
    const ts = redactStrict(c.text)
    const sql = await sqlRedact(c.text)
    rows.push({ name: c.name, ts, sql })
    const normalised = c.text.normalize('NFKC')
    const changed = (s: string) => s !== c.text && s !== normalised.replace(/[\u{AD}\u{200B}-\u{200F}\u{202A}-\u{202E}]/gu, '')
    if (c.secret === null) {
      check(`${c.name}: left alone by both`, !c.redacted && sql === ts && !changed(sql) && !changed(ts), `ts==sql ${sql === ts}`)
    } else {
      const probe = c.secret.normalize('NFKC').replace(/[\u{AD}\u{200B}-\u{200F}\u{202A}-\u{202E}]/gu, '')
      check(`${c.name}: redacted by both, the secret is gone, a family is named`, sql.includes('[redacted:') && ts.includes('[redacted:') && !sql.includes(probe) && !ts.includes(probe) && redactStrict(sql) === sql, `ts ${ts.includes('[redacted:')}, sql ${sql.includes('[redacted:')}, stable under a second pass ${redactStrict(sql) === sql}, families ${strictFamilies(c.text).join('+')}`)
    }
  }
  const differ = rows.filter((r) => r.ts !== r.sql)
  check('parity: every case is byte-identical between SQL and TypeScript', differ.length === 0, differ.length === 0 ? `${rows.length} identical` : `differ: ${differ.map((d) => d.name).join(', ')}`)

  // keys survive an assignment redaction, so the line still reads
  const kept = await sqlRedact('config password=hunter2synthetic retries=3')
  check('an assignment keeps its key and the text around it', kept === 'config password=[redacted:assignment] retries=3', kept)
  const urlKept = await sqlRedact('clone https://u:p4ssw0rdsyn@host.example/x.git')
  check('a URL keeps its scheme and host', urlKept === 'clone https://[redacted:url-credentials]@host.example/x.git', urlKept)
  const old = redactSecrets('Token:abcdefgh1234 password=hunter2synthetic')
  check('the office-wide redactor is unchanged (this work added a stricter twin, it did not alter it)', old === 'Token:abcdefgh1234 password=hunter2synthetic', 'redactSecrets leaves what it always left')

  // idempotent and bounded
  const idem: string[] = []
  for (const c of cases.filter((x) => x.secret !== null)) {
    const once = await sqlRedact(c.text)
    if ((await sqlRedact(once)) !== once) idem.push(c.name)
  }
  check('redacting twice is the same as once', idem.length === 0, idem.length === 0 ? 'idempotent over every secret case' : idem.join(', '))
  const long = await sqlRedact(`${'x'.repeat(3990)} password=${'a'.repeat(100)}`)
  check('input is bounded: at most 4 000 characters come back, and the tail is dropped, never returned', long.length <= 4000 && !long.includes('aaaaaaaaaa'), `${long.length} characters`)

  // seeded fuzz: SQL and TypeScript agree on arbitrary mixes
  let seed = 20261011
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed % n
  }
  const frags = [
    () => j('xo', 'xb-', String(100000 + rnd(900000)), '-', A.slice(rnd(10))), () => j('s', 'k-', 'or-', A.slice(0, 14 + rnd(8)), String(rnd(99))), () => j('gh', 'p_', A.slice(0, 22), String(rnd(99))),
    () => `password=${A.slice(rnd(10), 14 + rnd(10))}`, () => `"token": "${A.slice(rnd(5), 12 + rnd(10))} x"`, () => `Token:${A.slice(0, 9 + rnd(6))}${rnd(9)}`, () => `Bearer ${A.slice(0, 9 + rnd(6))}${rnd(9)}`,
    () => `postgresql://u${rnd(9)}:${A.slice(0, 6 + rnd(6))}@h${rnd(9)}.example/db`, () => `https://${A.slice(0, 20)}${rnd(99)}@git.example/x`, () => `${A.slice(rnd(6), 20 + rnd(6))}${A.toUpperCase().slice(rnd(6), 8)}${rnd(99)}`.repeat(1 + rnd(2)),
    () => `prompt_tokens=${rnd(9000)}`, () => `duration=${rnd(900)}ms`, () => `job ${rnd(1e6).toString(16).padStart(8, '0')}-1234-4abc-9def-0123456789ab`, () => 'the quarterly review covers pricing', () => `${j('s', 'k_test_', A.slice(0, 12))}${rnd(99)}`,
    () => `x${ZW}y`, () => '\n', () => ' ', () => ', ', () => `a1`.repeat(10 + rnd(30)),
  ]
  let fuzzBad = 0
  let fuzzIdem = 0
  for (let i = 0; i < 400; i++) {
    const text = Array.from({ length: 2 + rnd(8) }, () => (frags[rnd(frags.length)] as () => string)()).join(rnd(2) === 0 ? ' ' : '')
    const ts = redactStrict(text)
    const sql = await sqlRedact(text)
    if (ts !== sql) fuzzBad++
    if ((await sqlRedact(sql)) !== sql) fuzzIdem++
  }
  check('fuzz: 400 seeded mixed strings are byte-identical between SQL and TypeScript', fuzzBad === 0, `${fuzzBad} differ of 400`)
  check('fuzz: and every one is stable under a second pass', fuzzIdem === 0, `${fuzzIdem} unstable of 400`)

  // time: bounded and linear, on the shapes that were quadratic
  const timed = async (label: string, text: string, limitMs: number) => {
    const t0 = performance.now()
    await sqlRedact(text)
    const sqlMs = performance.now() - t0
    const t1 = performance.now()
    redactStrict(text)
    const tsMs = performance.now() - t1
    check(`time: ${label} under ${limitMs} ms in SQL and 100 ms in TypeScript`, sqlMs < limitMs && tsMs < 100, `sql ${sqlMs.toFixed(1)} ms, ts ${tsMs.toFixed(1)} ms`)
  }
  await timed('4 000 characters of prose', 'The quarterly review covers pricing, onboarding and support. '.repeat(70), 150)
  await timed('an unbroken a- run of 40 000 characters', 'a-'.repeat(20000), 150)
  await timed('one 4 000 character alphanumeric run', 'aB3'.repeat(1400), 150)
  await timed('300 short credential-shaped runs', Array.from({ length: 300 }, (_, i) => `Zx9Kq2LmN8pQ4rT7vW1yB3c${i}`).join(' '), 400)
  await timed('2 000 unmatched quotes after a key', `password=${'"'.repeat(2000)}`, 150)
  await timed('500 repeated assignments', 'token=abc '.repeat(400), 300)
  await timed('a 4 000 character URL-userinfo-shaped string', `https://${'a'.repeat(3900)}`, 150)

  // the external door and the ledger use it: a stored summary carries no credential, and the metadata cleaner keeps counts
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)

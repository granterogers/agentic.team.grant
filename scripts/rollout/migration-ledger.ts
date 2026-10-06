/**
 * The migration ledger: every migration file with its checksum, where it came from, what it depends on and whether production has it.
 * READ-ONLY and LOCAL: it reads `migrations/`, `migrations/applied.json` and git history, and contacts nothing.
 *
 *   npx tsx scripts/rollout/migration-ledger.ts            # every file, markdown table
 *   npx tsx scripts/rollout/migration-ledger.ts --pending  # only the files production is not known to hold
 *   npx tsx scripts/rollout/migration-ledger.ts --counts   # the reconciliation of the counts
 *
 * "Production applied" has three values and never guesses:
 *   yes      the file is in migrations/applied.json, which the migration runner writes when it applies a file and CI checks byte for
 *            byte (761 names with sha256), or it is on the documented list below.
 *   unknown  the Sample's 0897 to 0905: the HANDOFF and PUBLIC-SAMPLE record them as applied (770 in all) but no ledger in this
 *            repository holds their checksums, and nothing here has asked production. They are treated as applied and are never edited.
 *   no       everything else: committed, not recorded anywhere as applied.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

const P = 'origin/claude/multi-user-p4'
const BASE = '28569e68'
const args = process.argv.slice(2)

/** Applied to production per docs/HANDOFF.md and docs/multi-user/PUBLIC-SAMPLE.md (the Sample's), but absent from applied.json. */
const SAMPLE_RANGE = (n: number): boolean => n >= 897 && n <= 905

/** What each pending file needs first, from the code and the headers (not guessed: each line cites its reason). */
const DEPENDS: Record<string, string> = {
  '0906': 'its own table; ordered before 0920+. UX line.',
  '0907': 'documents columns; ordered before 0940/0960/0990. UX line.',
  '0920':
    'public.events.origin_channel; defines app.event_via_label, studio_activity, hq_studio_lately (the 0920 definitions). UX line.',
  '1021': '1020 and the UX chain 0897(0906) to 1010.',
  '1022': '1021.',
  '1023':
    'none (replaces app.office_health(uuid,integer) and app.last_progress(uuid); predecessors 0750/0753).',
  '1024':
    '0920 (restates app.job_via / client_via inline; replaces studio_activity as 0920 defined it).',
  '1025': 'none (replaces studio_unseen and studio_team_work; predecessors 0751).',
  '1026': '0216 (self_improvement_spent). Independent of the others.',
  '1027': 'none (replaces app.hq_pulse(uuid); predecessor 0751).',
  '1028':
    'none in the database; the hq-api gateway must be deployed AFTER it and rolled back BEFORE it is dropped.',
  '1029': '0920 (app.event_via_label, events.origin_channel). Fails at run time without it.',
  '1030':
    '0216 and the live app.dequeue_job as 0852 left it (same normalised fingerprint on the production-equivalent replica).',
  '1031': '1025 (restates app.studio_unseen as 1025 defined it, with one CTE materialised).',
}

const PURPOSE = (name: string): string => {
  const m = name
    .replace(/^\d{4}_/, '')
    .replace(/\.sql$/, '')
    .replace(/_/g, ' ')
  return m.length > 90 ? `${m.slice(0, 87)}...` : m
}

const git = (...a: string[]): string => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}
const isAncestor = (c: string, of: string): boolean => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', c, of], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const files = readdirSync('migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
const applied = JSON.parse(readFileSync('migrations/applied.json', 'utf8')) as Record<
  string,
  string
>
const sha = (f: string): string =>
  createHash('sha256')
    .update(readFileSync(`migrations/${f}`))
    .digest('hex')

const status = (f: string): 'yes' | 'unknown' | 'no' => {
  if (applied[f] !== undefined) return 'yes'
  // 0897 to 0905 are the Sample's; the UX files that once shared 0897 and 0900 are now 0906 and 0907, which are NOT in this range.
  return SAMPLE_RANGE(Number(f.slice(0, 4))) ? 'unknown' : 'no'
}

const counts = (): void => {
  const s = files.map(status)
  const yes = s.filter((x) => x === 'yes').length
  const unk = s.filter((x) => x === 'unknown').length
  const no = s.filter((x) => x === 'no').length
  console.log(`files in migrations/            ${String(files.length)}`)
  console.log(
    `recorded in applied.json (yes)  ${String(yes)}  (names + sha256, CI-checked; the last is 0891)`,
  )
  console.log(
    `documented applied (unknown)    ${String(unk)}  (the Sample's 0897-0905; HANDOFF says 770 = ${String(yes)} + ${String(unk)})`,
  )
  console.log(`not applied anywhere known (no) ${String(no)}`)
  console.log(
    `production applied, by the docs ${String(yes + unk)}  (UNVERIFIED: no read of app.schema_migrations was made)`,
  )
  console.log(
    `check: ${String(yes)} + ${String(unk)} + ${String(no)} = ${String(yes + unk + no)} = ${String(files.length)}`,
  )
}

if (args.includes('--counts')) {
  counts()
  process.exit(0)
}

console.log(
  '| number | filename | sha256 (first 16) | first commit | lineage | production applied | depends on | purpose |',
)
console.log('|---|---|---|---|---|---|---|---|')
for (const f of files) {
  const st = status(f)
  if (args.includes('--pending') && st === 'yes') continue
  const n = f.slice(0, 4)
  const first =
    git('log', '--diff-filter=A', '--format=%h', '--', `migrations/${f}`).split('\n').pop() ?? ''
  const lineage =
    first === ''
      ? 'unknown'
      : isAncestor(first, BASE)
        ? 'base'
        : isAncestor(first, P)
          ? 'p4 (Sample / UX integration)'
          : 'efficiency branch only'
  console.log(
    `| ${n} | ${f} | ${sha(f).slice(0, 16)} | ${first} | ${lineage} | ${st} | ${DEPENDS[n] ?? ''} | ${PURPOSE(f)} |`,
  )
}

/**
 * Stage the thinking-only gateway for scripts/deploy/hq-function-staged.ts. Offline: git and the file system only; no network.
 *
 *   npx tsx scripts/rollout/stage-hq-api-thinking.ts          writes .out/stage/hq-api-thinking/{index.ts,file-text.ts}
 *
 * Starts from the p4 tip (commit 1869d7ec, the line production's gateway was built from) and changes exactly one line
 * (scripts/rollout/thinking-only.ts). The deploy tool's dry run then shows how this differs from the LIVE source: it should be that
 * one line and nothing else. Anything more means the live gateway is not the p4 tip, and the deploy must not go ahead.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { thinkingOnly } from './thinking-only.ts'

const P4_TIP = '1869d7ec'
const OUT = '.out/stage/hq-api-thinking'
const show = (f: string): string =>
  execFileSync('git', ['show', `${P4_TIP}:supabase/functions/hq-api/${f}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

const base = show('index.ts')
const changed = thinkingOnly(base)
if (/resolveSession|const resolving = new Map/.test(changed))
  throw new Error(
    'the staged gateway contains the session single-flight, which is not part of this wave',
  )
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/index.ts`, changed)
writeFileSync(`${OUT}/file-text.ts`, show('file-text.ts'))
const a = base.split('\n')
const b = changed.split('\n')
const differing = a.filter((l, i) => l !== b[i]).length
console.log(
  `staged ${OUT}: index.ts ${b.length} lines, ${differing} line(s) differ from the p4 tip; file-text.ts is the p4 tip's`,
)

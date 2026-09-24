/*
 * Every action the experimental experience calls exists at the gateway.
 *
 * WHY THIS EXISTS, in one sentence: the first draft of the personal-task tick
 * called `my_task_state`, which is not an action — the gateway would have
 * refused it, so a control that looked finished could never have worked, and
 * nothing anywhere would have said so until somebody pressed it with a token.
 *
 * That is the same defect as an offer promising what the press cannot perform
 * and as a registry row claiming a capability nothing implements. It is
 * checkable without a database, without a token and without a browser: the
 * action names are literals in bc/*.js and the ACTIONS map is a literal in
 * the gateway's own source.
 *
 * It also checks the REQUIRED arguments, because an action that exists and is
 * called without an argument it insists on fails just as completely.
 */
import { readdir, readFile } from 'node:fs/promises'

const GATEWAY = 'supabase/functions/hq-api/index.ts'
const DIR = 'web/studio/bc'

const gateway = await readFile(GATEWAY, 'utf8')

/*
  The ACTIONS map, read out of the gateway rather than restated here.
  A copy of the list would be a second place for it to rot, and this check
  exists precisely because two places disagreed.
*/
const known = new Map<string, string[]>()
for (const m of gateway.matchAll(
  /^\s{2}([a-z][a-z0-9_]*):\s*\{\s*fn:\s*'([a-z0-9_]+)'(?:,\s*required:\s*\[([^\]]*)\])?/gm,
)) {
  const name = m[1]
  const required = (m[3] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter((s) => s !== '')
  if (name !== undefined) known.set(name, required)
}

if (known.size < 50) {
  console.error(
    `only ${String(known.size)} actions parsed out of the gateway — the map's shape has changed and this check has gone blind`,
  )
  process.exit(2)
}

/* What the experience actually calls, with the arguments it passes. */
type Call = { action: string; args: string[]; file: string }
const calls: Call[] = []
for (const f of await readdir(DIR)) {
  if (!f.endsWith('.js')) continue
  const src = await readFile(`${DIR}/${f}`, 'utf8')
  for (const m of src.matchAll(/\bact\(\s*'([a-z0-9_]+)'\s*,\s*\{([\s\S]{0,400}?)\}\s*\)/g)) {
    const action = m[1]
    if (action === undefined) continue
    const args = [...(m[2] ?? '').matchAll(/(\bp_[a-z0-9_]+)\s*:/g)].map((a) => a[1] ?? '')
    calls.push({ action, args, file: f })
  }
  // A call with no argument object at all.
  for (const m of src.matchAll(/\bact\(\s*'([a-z0-9_]+)'\s*\)/g)) {
    const action = m[1]
    if (action !== undefined) calls.push({ action, args: [], file: f })
  }
}

const problems: string[] = []
for (const c of calls) {
  const required = known.get(c.action)
  if (required === undefined) {
    problems.push(
      `${c.file}: act('${c.action}') — no such action at the gateway. A press that can only ever be refused.`,
    )
    continue
  }
  for (const need of required) {
    if (!c.args.includes(need)) {
      problems.push(
        `${c.file}: act('${c.action}') does not pass ${need}, which the gateway requires`,
      )
    }
  }
}

console.log(`${String(known.size)} gateway actions; ${String(calls.length)} call(s) from ${DIR}`)
for (const c of calls) {
  console.log(
    `  ${problems.some((p) => p.includes(`'${c.action}'`)) ? 'FAIL' : 'ok  '}  ${c.action}(${c.args.join(', ')})  [${c.file}]`,
  )
}

if (calls.length === 0) {
  /*
    A found-nothing check reports a perfect score. If the call parser stops
    matching — a reformat, a rename, a wrapper — this would go green over an
    experience calling anything at all.
  */
  console.error(
    '\nNO CALLS FOUND, which is not the same as no problems. The parser has gone blind.',
  )
  process.exit(2)
}

if (problems.length === 0) {
  console.log('\nevery action the experience calls exists, with its required arguments')
  process.exit(0)
}
console.log(`\n${String(problems.length)} PROBLEM(S):`)
for (const p of problems) console.log(`  - ${p}`)
process.exit(1)

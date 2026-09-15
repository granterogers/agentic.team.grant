/**
 * Run a session, or score what has been run.
 *
 *   npm run session -- --list
 *   npm run session -- --only corrections
 *   npm run session -- --only corrections --reset
 *   npm run session -- --report
 *
 * Resumable by design: a turn is a real job and the office's median is 53
 * seconds, so a long session cannot finish inside the ten minutes a Claude
 * session may spend on one foreground command. Progress lives in
 * `.out/sessions.jsonl` and a re-run continues from the next unanswered turn.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { byName, SESSIONS } from './corpus.ts'
import { askOnce, done, forget, recorded, remember, tidy } from './run.ts'

const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? undefined : argv[i + 1]
}

if (argv.includes('--list')) {
  console.log('\nsessions\n')
  for (const s of SESSIONS) {
    const n = await done(s.name)
    console.log(
      `  ${s.name.padEnd(16)} ${String(s.turns.length).padStart(2)} turns  ` +
        `${n === 0 ? '' : `${String(n)} recorded  `}${s.about}`,
    )
  }
  process.exit(0)
}

if (argv.includes('--report')) {
  const rows = await recorded()
  if (rows.length === 0) {
    console.log('nothing recorded yet')
    process.exit(0)
  }
  console.log(`\nsession results — ${String(rows.length)} turns\n`)
  let session = ''
  let pass = 0
  let fail = 0
  for (const r of rows) {
    if (r.session !== session) {
      session = r.session
      console.log(`  ${session}`)
    }
    pass += r.passes.length
    fail += r.fails.length
    const mark = r.fails.length === 0 ? 'ok  ' : 'FAIL'
    console.log(
      `    ${mark} ${String(r.index).padStart(2)}. ${r.why}` +
        `\n         ${r.state}, ${r.agent === '' ? 'nobody' : r.agent}` +
        `${r.projectSlug === '' ? '' : `, ${r.projectSlug}`}` +
        `${r.fails.length === 0 ? '' : `\n         FAILED: ${r.fails.join(' | ')}`}`,
    )
  }
  console.log(
    `\n${String(pass)}/${String(pass + fail)} expectations held across ${String(rows.length)} turns`,
  )
  process.exit(fail > 0 ? 1 : 0)
}

const name = flag('only')
const session = name === undefined ? undefined : byName(name)
if (session === undefined) {
  console.error('usage: npm run session -- --only <name> | --list | --report')
  process.exit(2)
}
/*
  A reset needs a NEW CHAT, not just a forgotten record.

  `inbound_commands.dedupe_key` is unique — correctly, it is what stops a
  double-send becoming two jobs — so replaying a session with the same keys is
  refused. And even if it were not, `app.conversation_before` threads on the
  chat, so turn 0 of the second run would open with the first run's four turns
  behind it and every referent test would be answering a question nobody asked.

  So each reset takes the next generation, and the generation is part of both
  the chat and the dedupe key. Nothing is deleted: the old rows are harness
  traffic in a fixture chat and deleting them would mean reaching through a
  foreign key to jobs that legitimately exist.
*/
const GENS = '.out/session-gens.json'
const gens: Record<string, number> = existsSync(GENS)
  ? (JSON.parse(await readFile(GENS, 'utf8')) as Record<string, number>)
  : {}
if (argv.includes('--reset')) {
  await forget(session.name)
  gens[session.name] = (gens[session.name] ?? 0) + 1
  await mkdir('.out', { recursive: true })
  await writeFile(GENS, JSON.stringify(gens))
  console.log(`forgot ${session.name} — generation ${String(gens[session.name])}`)
}
const gen = gens[session.name] ?? 0

const already = await done(session.name)
if (already >= session.turns.length) {
  console.log(`${session.name} is complete — ${String(already)} turns recorded`)
  process.exit(0)
}

/*
  One chat per session, stable across resumes.

  `app.conversation_before` threads on (channel, chat, subject), so a resumed
  run must rejoin the SAME chat or the office sees a stranger starting a new
  conversation — and every referent test would then pass or fail for the wrong
  reason. Derived from the session name rather than randomised for exactly that.
*/
const chat = `sess-${session.name}-g${String(gen)}`
const actor = `verify-sess-${session.name}`

/*
  Projects are created once, PAUSED, and found again on a resume.

  Paused because ADR-0014 refuses an active project with no enabled
  attachment — *"a project reads from and writes to somewhere real"* — and a
  harness project has nothing real behind it. It does not weaken the test: the
  project id travels on `inbound_commands.project_id`, so nothing here depends
  on name resolution, which is the only thing status gates.

  Same reasoning as the chat: a second set of projects would make "the other
  one" ambiguous in a way the product is not responsible for.
*/
const existing = (await recorded()).filter((r) => r.session === session.name)
const projects = new Map<string, string>()
if ((session.projects ?? []).length > 0) {
  const { db, lit } = await import('./run.ts')
  for (const label of session.projects ?? []) {
    /*
      Keyed on the session, NOT on the generation.

      A reset needs a fresh CHAT, because `app.conversation_before` threads on
      it and turn 0 of a re-run must not open with the previous run's turns
      behind it. The PROJECT has no such requirement, and giving it a
      generation too multiplied fixture projects one per reset — 41 of them in
      one night, each of which gathers a job and can then never be deleted
      (ADR-0022). Invisible to Grant because they are fixtures, and exactly the
      pile CLAUDE.md records twice.
    */
    const slug = `fixture-sess-${label}-${session.name}`
    const found = (
      (
        await db.execute(
          `select project_id::text as id from public.projects where slug = ${lit(slug)}`,
        )
      ).rows as { id: string }[]
    )[0]
    if (found !== undefined) {
      projects.set(label, found.id)
      continue
    }
    const made = (
      (
        await db.execute(`
          insert into public.projects (name, slug, status)
          values (${lit(`Fixture ${label} ${session.name}`)}, ${lit(slug)}, 'paused')
          returning project_id::text as id`)
      ).rows as { id: string }[]
    )[0]
    if (made !== undefined) projects.set(label, made.id)
  }
}

console.log(`\n${session.name} — ${session.about}`)
console.log(`  ${String(existing.length)}/${String(session.turns.length)} turns already recorded\n`)

const budget = Number(flag('minutes') ?? '8') * 60 * 1000
const stopAt = Date.now() + budget
const spawned: string[] = []

for (let i = existing.length; i < session.turns.length; i++) {
  if (Date.now() > stopAt) {
    console.log(`\n  out of time at turn ${String(i)} — re-run to continue`)
    break
  }
  const turn = session.turns[i]
  if (turn === undefined) break
  process.stdout.write(`  ${String(i)}. ${turn.why}\n     `)
  const result = await askOnce(session, i, turn, chat, actor, projects)
  spawned.push(result.jobId)
  await remember(result)
  console.log(
    `\n     ${result.state}, ${result.agent === '' ? 'nobody' : result.agent}` +
      `${result.projectSlug === '' ? '' : `, ${result.projectSlug}`}` +
      `, ${String(result.taskCount)} task(s)` +
      `\n     ${result.fails.length === 0 ? 'ok' : `FAILED: ${result.fails.join(' | ')}`}`,
  )
}

await tidy(spawned, projects)
const total = await done(session.name)
console.log(
  `\n${session.name}: ${String(total)}/${String(session.turns.length)} turns recorded. ` +
    'npm run session -- --report',
)

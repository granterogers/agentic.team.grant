/**
 * Real-world failure intake — §20.
 *
 *   npm run shadow:intake
 *
 * Grant hits something odd in normal use. This turns it into permanent
 * behavioural coverage in about two minutes, without anybody having to
 * understand the harness first.
 *
 * ## Why this exists rather than "just add a test"
 *
 * Because the thing that must NOT happen is the sentence going into a
 * pattern. §4 and CLAUDE.md's standing rule are the same instruction: a
 * failed sentence is evidence, not a vocabulary request. The intake's whole
 * job is to make the RIGHT thing - classify the family, keep the original
 * transcript separately, generate unseen siblings - cheaper than the wrong
 * one. If filing it properly costs twenty minutes and pasting the phrase
 * into a regex costs two, the regex wins, and the office learns the
 * sentence instead of the shape.
 *
 * It asks in Grant's own vocabulary (CLAUDE.md's five classifications), it
 * never asks for a secret, and it writes two files: a sanitised record, and
 * a ready-to-paste goal family.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { redactSecrets } from '../../src/text/secrets.ts'

/*
  Flags as well as questions.

  Interactive is how Grant will use it. Flags are how anything else will -
  a script, a CI step, or eventually the office filing its own finding,
  which is the direction CLAUDE.md's long-range goal points: a capability
  that exists only as an interactive prompt is one only a person at a
  terminal has.

  It also makes the tool testable. An intake nobody can run
  non-interactively is an intake nobody has run.
*/
const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const scripted = process.argv.includes('--said')

const rl = scripted ? null : createInterface({ input: stdin, output: stdout })
const ask = async (q: string, fallback = '', name?: string): Promise<string> => {
  if (rl === null) return (name === undefined ? undefined : flag(name)) ?? fallback
  const a = (await rl.question(`${q}\n  > `)).trim()
  return a === '' ? fallback : a
}

if (!scripted)
  console.log(`
Real-world failure intake

Something the office did in normal use that was wrong, confusing or
misleading. Answer what you can; blank is fine for anything you do not know.

Do NOT paste a token, a key or a password. If one is part of the story, say
where it is rather than what it is - and anything that looks like a
credential is stripped before this is written to disk anyway.
`)

const said = await ask('What did you actually type or say?', '', 'said')
if (said === '') {
  console.log('\nNothing to record.\n')
  rl?.close()
  process.exit(0)
}

const expected = await ask('What did you expect to happen?', '', 'expected')
const happened = await ask('What happened instead?', '', 'happened')
const channel = await ask('Where - telegram, slack, the dashboard, a call?', 'unknown', 'channel')
const jobId = await ask('A job id, if you have one (blank is fine)', '', 'job')

if (!scripted)
  console.log(`
How would you classify it? These are your own words from CLAUDE.md.

  1  SYSTEMIC PRODUCT DEFECT      a class of thing is broken, not one case
  2  LOCAL PRODUCT DEFECT         this one case is broken
  3  HARNESS DEFECT               the test was wrong, not the office
  4  EXPECTED STOCHASTIC VARIANCE  the model was having a bad day
  5  ENVIRONMENT / PROVIDER        something outside the office fell over
  ?  not sure - that is a perfectly good answer
`)
const klass = await ask('Which?', '?', 'class')

if (!scripted)
  console.log(`
What KIND of thing is this? Not the sentence - the shape of it. For example
"an obligation stated as a fact", "a change of mind written with a dash",
"a preference stated without saying from now on".

Getting this right is the whole point: the sentence becomes a regression
family, and the family is what stops the next variant of it slipping
through.
`)
const family = await ask('The shape, in a few words', '', 'family')

rl?.close()

// ---------------------------------------------------------------------------

const slug = family
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40)
const id = `intake-${new Date().toISOString().slice(0, 10)}-${slug === '' ? 'unclassified' : slug}`

/*
  Redacted on the way in, not on the way out.

  CLAUDE.md records a credential reaching `connection_health.detail` because
  a message was interpolated before anything looked at it. A record written
  and then cleaned is a record that existed uncleaned.
*/
const clean = (s: string): string => redactSecrets(s)

const KLASS: Record<string, string> = {
  '1': 'SYSTEMIC PRODUCT DEFECT',
  '2': 'LOCAL PRODUCT DEFECT',
  '3': 'HARNESS DEFECT',
  '4': 'EXPECTED STOCHASTIC VARIANCE',
  '5': 'ENVIRONMENT / PROVIDER FAILURE',
  '?': 'not yet classified',
}

mkdirSync('docs/shadow-grant/intake', { recursive: true })
const record = `# ${family === '' ? 'Unclassified intake' : family}

**Classification:** ${KLASS[klass] ?? KLASS['?']}
**Channel:** ${clean(channel)}
**Recorded:** ${new Date().toISOString().slice(0, 10)}
${jobId === '' ? '' : `**Job:** \`${clean(jobId)}\`\n`}
## What was said

> ${clean(said)}

## What was expected

${clean(expected) || '_not stated_'}

## What happened

${clean(happened) || '_not stated_'}

## Canonical evidence

_Fill in from the job row, the output body, the impediment and the routing
decision. CLAUDE.md: investigate before theorising - this file records
several occasions where a confident reading of a symptom was wrong and one
query settled it._

\`\`\`
npm run q -- "select state, recipient_agent, state_reason from public.jobs where job_id = '...'"
npm run qq -- "select body from public.outputs where job_id = '...'"
\`\`\`

## The family, not the sentence

**${family || 'TO BE NAMED'}**

The sentence above is one instance. Before anything is changed, write down
three more instances that share the shape and none of the words, and check
whether they fail too. If they do not, this is a local defect. If they do,
it is a class, and the fix belongs at the level of the class.

## Regression

Paste the family below into \`src/simulation/goals.ts\` and it joins every
future run — baseline, held-out, Shadow Grant and variance — automatically.
`

const path = `docs/shadow-grant/intake/${id}.md`
writeFileSync(path, record)

const stub = `  {
    id: '${slug === '' ? 'intake.unclassified' : `intake.${slug}`}',
    group: 'intake',
    about: '${family.replace(/'/g, "\\'")}',
    draft: (_w, r) => ({
      // Three MORE phrasings of the same shape, sharing none of the words.
      // The original is kept in ${path} and is deliberately not the only one
      // here: a family with one member is a phrase list with extra steps.
      say: one(r, [
        '${clean(said).replace(/'/g, "\\'")}',
        'TODO: a sibling that shares the shape and not the words',
        'TODO: another, phrased the way it would arrive in a voice note',
      ], '${clean(said).replace(/'/g, "\\'")}'),
      intent: {
        want: '${clean(expected).replace(/'/g, "\\'") || 'TODO: what the person actually wanted'}',
        effect: 'none', // TODO: none | task | task_changed | document | delivery | preference | blocked | declined
        turnsOn: 'comprehension', // TODO: comprehension | referent | history | execution
      },
      why: '${(family || 'TODO').replace(/'/g, "\\'")}',
    }),
  },`

const stubPath = `.out/${id}.family.ts`
mkdirSync('.out', { recursive: true })
writeFileSync(stubPath, stub)

appendFileSync(
  'docs/shadow-grant/intake/INDEX.md',
  `| ${new Date().toISOString().slice(0, 10)} | ${family || 'unclassified'} | ${KLASS[klass] ?? '?'} | [record](${id}.md) |\n`,
)

console.log(`
Recorded.

  ${path}
      the sanitised transcript and what to check next

  ${stubPath}
      a goal family, ready to paste into src/simulation/goals.ts

Two things before this is finished, and the second is the one that matters:

  1. Fill in the canonical evidence. The job row settles arguments that
     three readings of the symptom will not.

  2. Replace the two TODO siblings with real ones. A family with a single
     member is a phrase list with extra steps, and a fix tested only against
     the sentence that prompted it teaches the office that sentence.
`)

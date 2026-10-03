/**
 * The canonical layer answers QUESTIONS about the office, and sends REQUESTS FOR WORK to the team (0867).
 *   npm run sample:voice-answer
 *
 * Drives the real `app.voice_answer` for the Sample's office with a corpus of messages, each inside a block that is rolled
 * back (one DO statement ending in a deliberate exception whose message carries the verdicts), so nothing is left behind and
 * no job is created. Semantic neighbours of the sentence that failed, and the negative controls that prove the guard did
 * not buy precision with recall: real questions must still be answered.
 *
 * What failed: "Ask the finance specialist to summarise the assumptions in the budget documents in this project." was
 * answered by a usage report because of the word budget.
 */
import { lit, rows, sampleOffice } from './lib.ts'

const office = await sampleOffice()
const O = office.officeId

/** [message, true when the cheap path may answer it]. */
const CORPUS: [string, boolean][] = [
  // requests for work that contain a word the branches key on: must NOT be answered with a canned report
  [
    'Ask the finance specialist to summarise the assumptions in the budget documents in this project.',
    false,
  ],
  ['Draft the 2027 budget for the studio launch.', false],
  [
    'Have the research specialist compare three fictional venue options already in this project.',
    false,
  ],
  ['Write up the schedule for the retreat weekend.', false],
  ['Please review the cost of the flights to Tokyo and tell me which is cheapest.', false],
  ['Create a task to decide on the venue and set a deadline.', false],
  ['Compare the spend on the three insurance quotes and summarise the report.', false],
  [
    'Put together a list of the projects we should prioritise this quarter given the budget, the calendar and what is blocked and what is waiting on me and what each person owes.',
    false,
  ],
  // real questions about the office's own state: must still be answered
  ['How much have we spent on the model calls today?', true],
  ['What is the usage cost so far today?', true],
  ['What is on my calendar today?', true],
  ['What is waiting for me?', true],
  ['What projects do we have?', true],
]

const verdicts = new Map<string, boolean>()
let n = 0
for (const [said, _] of CORPUS) {
  n += 1
  const probe = `do $x$
    declare c uuid; r jsonb; p uuid;
    begin
      select project_id into p from public.projects where office_id = ${lit(O)}::uuid order by slug limit 1;
      insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id, office_id)
      values ('teamhq', 'chat:va${n}', 'p4-second-person', ${lit(said)}, 'teamhq:verify_voiceanswer:${Date.now()}.${n}', p, ${lit(O)}::uuid)
      returning command_id into c;
      r := app.voice_answer(${lit(O)}::uuid, c);
      raise exception 'VERDICT:%', (r is not null and r ? 'speak');
    end $x$`
  const said2 = await rows(probe).then(
    () => 'no-verdict',
    (e: unknown) => String(e instanceof Error ? e.message : e),
  )
  const m = /VERDICT:(t|f)/.exec(said2)
  if (m === null) {
    console.log(`FAIL could not read a verdict for "${said.slice(0, 50)}": ${said2.slice(0, 160)}`)
    process.exitCode = 1
    continue
  }
  verdicts.set(said, m[1] === 't')
}
let bad = 0
for (const [said, want] of CORPUS) {
  const got = verdicts.get(said)
  const ok = got === want
  if (!ok) bad += 1
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${want ? 'answers' : 'sends to the team'}: "${said.slice(0, 70)}"${ok ? '' : `  (got ${got === undefined ? 'nothing' : got ? 'an answer' : 'no answer'})`}`,
  )
}
const left = Number(
  (
    await rows(
      `select count(*) n from public.inbound_commands where office_id = ${lit(O)}::uuid and dedupe_key like 'teamhq:verify_voiceanswer:%'`,
    )
  )[0]?.n ?? 0,
)
console.log(`${left === 0 ? 'ok  ' : 'FAIL'} the probe rows were rolled back (${left} left)`)
console.log(`\nsample:voice-answer: ${CORPUS.length - bad}/${CORPUS.length} verdicts as intended`)
if (bad > 0 || left !== 0) process.exitCode = 1

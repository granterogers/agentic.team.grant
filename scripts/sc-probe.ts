import { consequenceClaims, emailCapabilityClaims } from '../src/agents/consequence.ts'

const all = [
  'The contract says the invoice was emailed to the client on 3 March.',
  'According to the minutes, the deposit was sent to the venue last week.',
  'Daniel noted that the quote was forwarded to procurement.',
  'The approval was sent back with two comments.',
  'We sent the proposal in June, per the thread.',
  'Sent items are in the Sent folder.',
  'The newsletter went out last Tuesday according to the thread.',
  'I have not sent anything to Kevin.',
  'I forwarded the question to Daniel.',
  'The report is ready for you to send to Kevin.',
  'The shared drive holds three budget files.',
  'The venue was booked in March and the deposit is due on 1 June.',
  'The message was sent to the wrong address, which is why Kevin never got it.',
  'Everything that was posted in the channel is summarised below.',
  'The documents that were shared with Kevin are listed in the register.',
  'The invoice was sent to the client, so the status is paid.',
]
for (const t of all)
  console.log(JSON.stringify(t), '=>', JSON.stringify(consequenceClaims(t).map((c) => c.cls)), emailCapabilityClaims(t).length)

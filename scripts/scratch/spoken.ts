import { optionFor, spokenAnswer } from '../../src/agents/spoken-answer.ts'

for (const s of process.argv.slice(2)) {
  const a = spokenAnswer(s)
  console.log(
    JSON.stringify(s),
    a,
    a === null || a === 'unclear' ? '' : optionFor(a, ['Yes, do it', 'No, leave it']),
  )
}

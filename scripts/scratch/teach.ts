import { readTeaching } from '../../src/agents/teaching.ts'

for (const s of process.argv.slice(2)) {
  const t = readTeaching(s)
  console.log(
    `${t ? '  !!' : '  --'} ${JSON.stringify(s)}${t ? `  => ${JSON.stringify(t).slice(0, 140)}` : ''}`,
  )
}

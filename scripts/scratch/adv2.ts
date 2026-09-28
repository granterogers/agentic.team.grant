import { artifactRequest, notebookRequest } from '../../src/agents/actions.ts'

for (const s of process.argv.slice(2)) {
  const a = artifactRequest(s),
    n = notebookRequest(s)
  console.log(
    `${a || n ? '  !!' : '  --'} ${JSON.stringify(s)}${a ? `  artifact=${JSON.stringify(a).slice(0, 90)}` : ''}${n ? `  notebook=${JSON.stringify(n).slice(0, 90)}` : ''}`,
  )
}

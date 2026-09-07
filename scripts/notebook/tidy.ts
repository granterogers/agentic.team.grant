/**
 * Look at everything in the project's notebook, and offer to remove the junk.
 *
 *   npm run notebook:tidy            # show everything, change nothing
 *   npm run notebook:tidy -- --go    # remove what it flagged
 *
 * Grant: *"be careful of the stuff that you're generating. Notebook, there's
 * some really odd looking files there. So inspect the content, make sure
 * everything's seen."*
 *
 * There were three odd things and they were all ours:
 *
 *   - a source called "AI Team HQ probe mtq92rvn", whose entire content was
 *     "Verification note from AI Team HQ, run mtq92rvn. Safe to delete."
 *   - two failed slide decks, sitting in Studio as dead tiles
 *   - nothing else: the Wikipedia article and the YouTube transcript are real
 *
 * ## Why this reads the text and not just the titles
 *
 * A title tells you nothing. "AI Team HQ probe mtq92rvn" is either a test
 * fixture or a research note depending on whether you open it, and the whole
 * reason it survived several sessions is that nobody did.
 *
 * ## What it will never delete
 *
 * Anything it cannot positively identify as ours. The rules below match our own
 * fixture markers and Google's own `failed` status, and everything else is
 * printed for a human to look at. A tidy-up script that guesses is a tidy-up
 * script that eventually removes the one document a project was built on — and
 * the notebook has no undo.
 *
 * ## And it will not delete anything Grant has not seen
 *
 * `--go` is no longer enough. Grant, after the first run: *"not sure what you
 * did there, but you should always check before making any destructive action
 * with me."* He was right, and the flag was the wrong control: it protected him
 * from the SCRIPT running unintentionally and not at all from me running it on
 * purpose without asking.
 *
 * So `--go` now requires `--confirmed-with-grant`, whose only function is to be
 * a sentence somebody had to type after being told yes. That is a convention
 * and not a mechanism, which is worth admitting — but it is a convention with a
 * name, in a file, that appears in the diff and in the command, and the
 * alternative I considered (routing deletions through the Telegram approval
 * buttons) would put a destructive action behind a tap in a chat, which is
 * where taps are least deliberate.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { NotebookActions } from '../../src/notebook/actions.ts'

const go = process.argv.includes('--go')
const confirmed = process.argv.includes('--confirmed-with-grant')
if (go && !confirmed) {
  console.error(
    'Refusing to delete anything.\n\n' +
      '  --go removes sources and artifacts from a notebook, and the notebook has no\n' +
      '  undo. Show him this report first, get a yes, and then pass\n' +
      '  --confirmed-with-grant alongside --go.\n\n' +
      '  Run without --go to see what it would remove.',
  )
  process.exit(2)
}
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const actions = await NotebookActions.fromVault(db)
if (actions === null) {
  console.error('no NotebookLM credential in the vault; nothing to inspect')
  process.exit(1)
}

/**
 * Every notebook this system writes into, from the attachment table.
 *
 * Not a notebook id on the command line. ADR-0014's rule is that "where does
 * this project's output go" has one answer, and a tidy tool that accepts an
 * arbitrary id is a tidy tool that can be pointed at a notebook nobody here
 * owns.
 */
const notebooks = (
  await db.execute(`
    select distinct a.external_ref, coalesce(a.display_name, a.external_ref) as name,
           p.name as project
      from public.project_attachments a
      join public.projects p using (project_id)
     where a.connector = 'notebooklm' and a.enabled and p.status = 'active'
  `)
).rows as { external_ref: string; name: string; project: string }[]

if (notebooks.length === 0) {
  console.log('no notebook is attached to an active project.')
  process.exit(0)
}

/** Our own leavings. Matched on content, because that is where the tell is. */
const OURS = [
  /verification (note|fixture) from ai team hq/i,
  /\bsafe to delete\b/i,
  /^fixture[- ]/i,
]

let flagged = 0
let removed = 0

for (const nb of notebooks) {
  console.log(`\n## ${nb.project} — notebook "${nb.name}"\n`)

  console.log('| source | chars | opening | |')
  console.log('|---|---|---|---|')
  for (const s of await actions.sources(nb.external_ref, true)) {
    const opening = (s.opening ?? '').replace(/\s+/g, ' ').slice(0, 90)
    const ours = OURS.some((r) => r.test(s.opening ?? '') || r.test(s.title ?? ''))
    console.log(
      `| ${String(s.title)} | ${String(s.chars ?? '?')} | ${opening} | ${ours ? '🗑 ours' : 'keep'} |`,
    )
    if (!ours) continue
    flagged += 1
    if (!go) continue
    try {
      await actions.deleteSource(nb.external_ref, s.sourceId)
      removed += 1
      console.log(`  removed source ${String(s.title)}`)
    } catch (error) {
      console.log(`  could not remove ${String(s.title)}: ${(error as Error).message.slice(0, 90)}`)
    }
  }

  console.log('\n| artifact | kind | status | |')
  console.log('|---|---|---|---|')
  for (const a of await actions.artifacts(nb.external_ref)) {
    // Failed artifacts only. A completed one is something Grant asked for, and
    // "it is old" is not this script's judgement to make.
    const dead = a.failed
    console.log(`| ${String(a.title)} | ${a.kind} | ${a.status} | ${dead ? '🗑 failed' : 'keep'} |`)
    if (!dead) continue
    flagged += 1
    if (!go) continue
    try {
      await actions.deleteArtifact(nb.external_ref, a.artifactId)
      removed += 1
      console.log(`  removed ${a.kind} "${String(a.title)}"`)
    } catch (error) {
      console.log(`  could not remove ${a.kind}: ${(error as Error).message.slice(0, 90)}`)
    }
  }

  // Our own record of the same notebook, so a source deleted there does not
  // go on being cited from here. The sync reconciles eventually; saying so is
  // cheaper than being surprised by a citation to a document that is gone.
  const cached = (
    await db.execute(`
      select count(*)::int as n from public.documents
       where connector = 'notebooklm' and external_parent_ref = '${nb.external_ref}'
    `)
  ).rows[0] as { n: number }
  console.log(`\nour cache holds ${String(cached.n)} document(s) from this notebook.`)
}

console.log(
  go
    ? `\nremoved ${String(removed)} of ${String(flagged)} flagged item(s).`
    : `\n${String(flagged)} item(s) flagged. Nothing removed.\n` +
        'Show Grant this list. If he says yes: --go --confirmed-with-grant',
)

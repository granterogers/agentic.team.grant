/**
 * ONE OFFICE, THREE DOORS — AND ONE PLACE THAT DECIDES WHAT GRANT MEANS (#282).
 *
 *   npm run check:one-brain
 *
 * Telegram (voice and text), Slack and Team HQ are interfaces into one office.
 * §5 of the master spec says an adapter may only TRANSLATE: every surface
 * writes to `inbound_commands` and asks the canonical layer, and an adapter
 * that decides is a bug.
 *
 * ## Why a check rather than a sentence
 *
 * The mission's hypothesis supposed the three doors might have grown
 * independent natural-language brains. They have not — tracing every ingress
 * found one path,
 * `inbound_commands -> enqueue_inbound -> office.instruction`, which is why
 * placing `understand()` there fixed all of them at once.
 *
 * That is a property worth keeping, and nothing was keeping it. The cheapest
 * way for it to break is somebody adding "just a small regex" to the Slack
 * adapter for one shape the office reads badly — a change that would look
 * local, pass every suite, and put a second interpretation of human language
 * in the building. A month later the two disagree and the symptom is that the
 * same sentence behaves differently depending on which door Grant used.
 *
 * ## An ALLOW list, not a forbid list
 *
 * A list of forbidden modules is an enumeration of things a future change will
 * add to, and CLAUDE.md records that correction four times. So the rule is the
 * other way round: an adapter may import the handful of `src/agents` modules
 * named below, each with a reason, and **anything else is refused by default**
 * — including a module that does not exist yet, which is the whole point.
 *
 * The permitted ones are all OUTPUT side. Reading what the office is about to
 * say, to decide how to render or whether to send it, is translation. Reading
 * what GRANT said, to decide what he meant, is not.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
  Where a message from a person enters the building. `src/jobs`, `src/office`
  and `src/handlers` are deliberately absent: the handler is the one place that
  is SUPPOSED to interpret.
*/
const DOORS = [
  'src/channels',
  'src/slack',
  'supabase/functions/telegram-webhook',
  'supabase/functions/slack-events',
  'supabase/functions/voice',
  'supabase/functions/hq-api',
]

/**
 * The `src/agents` modules an adapter may touch, and why each is translation
 * rather than interpretation.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'quality.ts':
    'output side — deciding whether the office may SEND what it wrote, and how ' +
    'to render its provenance. It reads the answer, never the request.',
  'provenance.ts':
    'output side — the shared definition of what counts as a source, so two ' +
    'channels cannot disagree about it.',
}

const findings: { file: string; module: string }[] = []
let scanned = 0

const walk = (dir: string): string[] => {
  let out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out = out.concat(walk(path))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

for (const door of DOORS) {
  let files: string[] = []
  try {
    files = walk(door)
  } catch {
    // A door that does not exist is not a failure; the list is deliberately
    // broader than the tree so a new surface is covered the day it appears.
    continue
  }
  for (const file of files) {
    scanned += 1
    const source = readFileSync(file, 'utf8')
    /*
      Every import of the agents layer, however it is spelled. `type` imports
      count: a channel that needs an interpreter's TYPE is a channel about to
      need its function.
    */
    for (const hit of source.matchAll(/from\s+'[^']*agents\/([A-Za-z0-9_-]+\.ts)'/g)) {
      const module = hit[1] ?? ''
      if (module in ALLOWED) continue
      findings.push({ file, module })
    }
  }
}

console.log(
  `one brain — ${String(scanned)} adapter file(s) across ${String(DOORS.length)} door(s)\n`,
)

if (findings.length === 0) {
  console.log('  ok   no door interprets. Every surface translates and asks the canonical layer.')
  console.log(
    `\n  permitted, output side only: ${Object.keys(ALLOWED).join(', ')}\n` +
      '  anything else in src/agents is refused by default, including a module\n' +
      '  that does not exist yet.',
  )
  process.exit(0)
}

console.error('  A DOOR IS READING WHAT GRANT MEANT. §5: an adapter may only translate.\n')
for (const f of findings) {
  console.error(`  FAIL ${f.file} imports agents/${f.module}`)
}
console.error(
  '\n  Interpretation belongs in the office.instruction handler, which every\n' +
    '  surface already reaches through inbound_commands. A second reader of\n' +
    '  human language is two readers that will disagree, and the symptom is the\n' +
    '  same sentence behaving differently depending on which door was used.\n' +
    '\n  If this module really is output-side translation, add it to ALLOWED with\n' +
    '  the reason — an entry with no reason is an admission.',
)
process.exit(1)

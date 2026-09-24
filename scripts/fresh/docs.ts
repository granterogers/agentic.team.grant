/**
 * GENERATE THE CANONICAL SETUP DOCUMENT.
 *
 *   npm run fresh:docs            write SETUP.md from the contract
 *   npm run fresh:docs -- --check fail if SETUP.md is not what would be written
 *
 * §17 asks for ONE obvious current starting point for a new person, and §6 asks
 * for one machine-readable source of truth for setup state. Those two pull in
 * opposite directions the moment somebody edits the prose: the document drifts
 * from the contract, and the drift is invisible because both look fine.
 *
 * So the document is GENERATED. `src/fresh/contract.ts` is the source; SETUP.md
 * is a rendering of it; `--check` in the gate means they cannot disagree. Add a
 * step to the contract and the document grows it. Edit the document by hand and
 * the gate says so.
 *
 * This repository has already paid for the alternative. A requirements document
 * was stored as "a tidied summary and read as canonical for a week", and
 * CLAUDE.md's rule is the one this obeys from the other end: do not keep two
 * copies of a thing that must agree.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { CONTRACT, type ContractEntry, humanEffort } from '../../src/fresh/contract.ts'

const OUT = 'SETUP.md'

function section(entry: ContractEntry, n: number): string {
  const lines: string[] = []
  lines.push(`### ${n}. ${entry.title}`)
  lines.push('')
  lines.push(entry.why)
  lines.push('')
  if (entry.human !== undefined) {
    lines.push(
      `**This one needs you.** No software may do it — ${entry.human.because} — ` +
        `so it is on your list rather than the computer's. ` +
        `About ${entry.human.minutes} minutes. Cost: ${entry.human.cost}.`,
    )
    lines.push('')
    for (const [i, step] of entry.human.steps.entries()) lines.push(`${i + 1}. ${step}`)
  } else if (entry.automatedBy !== undefined) {
    /*
      Not everything without a `human` block is done by the computer.

      Installing Node is a person's job and does not belong on the human-only
      list, because it fails §8's filter: it needs no identity, no consent, no
      payment and no one-time secret. Saying "the computer does this one" over
      an instruction to go and download something is the kind of small lie that
      makes a reader stop trusting the rest of the page.
    */
    const isCommand = /^(npm|npx|export|node|git)\b/.test(entry.automatedBy)
    if (isCommand) {
      lines.push('**The computer does this one.** Run:')
      lines.push('')
      lines.push('```bash')
      lines.push(entry.automatedBy)
      lines.push('```')
    } else {
      // Prose in a shell block reads as something to paste and fails when
      // somebody does.
      lines.push(`**Quick, and yours to do.** ${entry.automatedBy}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

function render(): string {
  const core = CONTRACT.filter((e) => e.requirement === 'REQUIRED_FOR_CORE')
  const optional = CONTRACT.filter((e) => e.requirement !== 'REQUIRED_FOR_CORE')
  const effort = humanEffort(core)
  const humanCore = core.filter((e) => e.human !== undefined)

  const out: string[] = []
  out.push('<!--')
  out.push('  GENERATED — do not edit by hand.')
  out.push('')
  out.push('  Written by `npm run fresh:docs` from `src/fresh/contract.ts`, which is the')
  out.push('  single source of truth for what an installation of this office needs.')
  out.push('  `npm run check:fresh` fails if this file and the contract disagree, so an')
  out.push('  edit here is a change that will be overwritten. Change the contract.')
  out.push('-->')
  out.push('')
  out.push('# Set up your own Agentic Team')
  out.push('')
  out.push(
    'This is the one page to follow. Anything else in this repository that looks ' +
      'like setup instructions is a record of how **this particular** office was ' +
      'built, and is kept for history rather than for you.',
  )
  out.push('')
  out.push('## What you are setting up')
  out.push('')
  out.push(
    'Eight members of staff — a Chief of Staff, and directors for strategy, ' +
      'research, finance, operations, growth, communications and quality. You give ' +
      'them work in ordinary language. They queue it, decide between them who ' +
      'should answer, do it, check it before it commits, and tell you. Only the ' +
      'Chief of Staff messages you; everybody else still does the work and writes ' +
      'it down where you can read it.',
  )
  out.push('')
  out.push('## What it costs')
  out.push('')
  out.push(
    'Nothing, for everything in the required list below. Supabase’s free tier ' +
      'holds the office, and the models it thinks with are free ones. The single ' +
      'paid thing in the whole system is talking to it out loud, which is optional ' +
      'and switched off until you ask for it.',
  )
  out.push('')
  out.push('## How long')
  out.push('')
  out.push(
    `About **${effort.minutes} minutes of your time**, spread across ` +
      `**${humanCore.length} things only you can do**: ` +
      `${humanCore.map((e) => e.title).join('; ')}. ` +
      'Everything else is a command you run and wait a moment for.',
  )
  out.push('')
  out.push('## If you only remember one thing')
  out.push('')
  out.push('```bash')
  out.push('npm run fresh:doctor')
  out.push('```')
  out.push('')
  out.push(
    'It looks at what you have, tells you the **one** thing to do next, and says ' +
      'whether that thing is yours or the computer’s. Run it whenever you are ' +
      'unsure, including halfway through. Nothing here has to be done in one ' +
      'sitting, and nothing is damaged by stopping.',
  )
  out.push('')
  out.push('---')
  out.push('')
  out.push('## The required steps')
  out.push('')
  for (const [i, entry] of core.entries()) out.push(section(entry, i + 1))
  out.push('---')
  out.push('')
  out.push('## When it is done')
  out.push('')
  out.push(
    'Setup is not finished when the configuration is complete. It is finished when ' +
      'you have asked your office something and it has answered — which is what the ' +
      'last required step does, and why it is on the list.',
  )
  out.push('')
  out.push('## Optional — add any of these later, or never')
  out.push('')
  out.push(
    'None of these is needed for the office to work, and a missing one never ' +
      'breaks anything else. Add one when you want what it does.',
  )
  out.push('')
  for (const entry of optional) {
    out.push(`### ${entry.title}`)
    out.push('')
    out.push(`*${entry.feature ?? 'optional'}* — ${entry.why}`)
    out.push('')
    if (entry.human !== undefined) {
      out.push(
        `Needs you (${entry.human.because}), about ${entry.human.minutes} minutes. ` +
          `Cost: ${entry.human.cost}.`,
      )
      out.push('')
      for (const [i, step] of entry.human.steps.entries()) out.push(`${i + 1}. ${step}`)
    } else if (entry.automatedBy !== undefined) {
      out.push(`Run: \`${entry.automatedBy}\``)
    }
    out.push('')
  }
  out.push('---')
  out.push('')
  out.push('## If something goes wrong')
  out.push('')
  out.push('**Run `npm run fresh:doctor`.** It is the answer to most of this.')
  out.push('')
  out.push('| What happened | What to do |')
  out.push('|---|---|')
  out.push(
    '| You stopped halfway through | Run the same command again. Nothing is left half-done: the install is a single step that either happens or does not. |',
  )
  out.push(
    '| A credential is wrong | The doctor names which one and where to get another. Replace it and carry on from where you were. |',
  )
  out.push(
    '| You want to start again | Make a new, empty database and install into that. Installing over an existing office is refused, on purpose. |',
  )
  out.push(
    '| You installed a while ago and have pulled new changes | `npm run migrate` — it applies only what is new. |',
  )
  out.push('| Something else | `npm run fresh:doctor`, then `npm run fresh:accept` |')
  out.push('')
  out.push('## About your secrets')
  out.push('')
  out.push(
    'Every credential goes into your own database’s vault, through ' +
      '`npm run fresh:secret`, which prompts you and does not echo what you type. ' +
      'It refuses a value passed on the command line — an argument lives in your ' +
      'shell history, in `ps` output while it runs, and in your terminal ' +
      'scrollback. Nothing in this repository ever prints a credential back to ' +
      'you, including when it is the thing that is wrong.',
  )
  out.push('')
  out.push('## Proving it all still works')
  out.push('')
  out.push('```bash')
  out.push('npm run fresh:accept')
  out.push('```')
  out.push('')
  out.push(
    'Installs an office into a throwaway database, asks it a question, and checks ' +
      'ten separate things about the experience you have just had — including that ' +
      'nothing in your office belongs to anybody else. It needs no account and ' +
      'costs nothing.',
  )
  out.push('')
  return out.join('\n')
}

async function main(): Promise<void> {
  const wanted = render()
  if (process.argv.includes('--check')) {
    let found: string | null = null
    try {
      found = await readFile(OUT, 'utf8')
    } catch {
      found = null
    }
    if (found !== wanted) {
      console.error(
        `${OUT} is not what the contract would produce.\n\n` +
          'It is generated, so the fix is never to edit it: change ' +
          'src/fresh/contract.ts and run `npm run fresh:docs`.',
      )
      process.exit(1)
    }
    console.log(`${OUT} matches the contract`)
    return
  }
  await writeFile(OUT, wanted, 'utf8')
  console.log(`wrote ${OUT} — ${wanted.split('\n').length} lines, from the setup contract`)
}

await main()

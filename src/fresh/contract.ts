/**
 * THE SETUP CONTRACT — one machine-readable source of truth for what an
 * installation of this office needs.
 *
 * §6 of the fresh-install brief asks for exactly this, and says why: the same
 * list currently exists, differently, in `docs/prerequisites.md` (dated
 * 2026-09-02), in `HUMAN_ONLY_PREREQUISITES.md` (which is Grant's own account
 * history), in `app.hq_setup()`, in the Settings page and in a dozen deploy
 * scripts. Four of those disagree. A person following any one of them is
 * following a guess about the other three.
 *
 * So this is the list, and everything else reads it: `npm run fresh:doctor`
 * runs the verifications, `npm run fresh:accept` proves the classifications
 * hold, and the canonical setup document is generated from it rather than
 * written beside it.
 *
 * ## The rules this file has to obey
 *
 * **Every entry says how it is VERIFIED.** §9: *"credentials are functionally
 * verified where safe, not just non-empty."* An entry whose check is "the
 * variable is set" says so in `verifies`, so nobody mistakes presence for a
 * working connection.
 *
 * **Every entry says whether a human is genuinely needed**, and only survives
 * §8's filter: repository code cannot do it, no official CLI can, no official
 * API can, no safe supported browser automation can, and it truly requires
 * identity, consent, payment, a CAPTCHA, a one-time secret retrieval, provider
 * policy or a subjective choice. Everything else names the command that does it.
 *
 * **A human step carries the exact steps, with URLs.** Grant's standing
 * instruction: *"Always be explicit with instructions!!! Never assume I just
 * know what you are referring to. Also include full instructions each and every
 * time with URLs, steps to follow, etc."*
 *
 * **No entry ever holds a secret value.** Names of secrets, never values.
 */

/** What an installation cannot work without, and what it merely benefits from. */
export type Requirement =
  /** The minimum viable install cannot function without it. */
  | 'REQUIRED_FOR_CORE'
  /** Required only if you want that particular feature or channel. */
  | 'REQUIRED_FOR_FEATURE'
  /** Genuinely additive. Its absence must not break anything else. */
  | 'OPTIONAL'
  /** For developing or maintaining the office. A user never needs it. */
  | 'DEV_ONLY'

/** How the check actually establishes the thing is true. */
export type Verification =
  /** Something was called and it answered. The strongest available. */
  | 'functional'
  /** A row, a count or a deployed artifact was read back. */
  | 'observed'
  /** Only that a value is present. Says nothing about whether it works. */
  | 'presence'
  /** Nothing automatic can tell; a person has to look. */
  | 'manual'

export interface HumanStep {
  /** Which of §8's genuine reasons this is, so the list cannot quietly grow. */
  readonly because:
    | 'identity verification'
    | 'consent'
    | 'payment'
    | 'CAPTCHA'
    | 'one-time secret retrieval'
    | 'provider policy'
    | 'a subjective choice'
  /** Numbered, with URLs. What a person does, in order. */
  readonly steps: readonly string[]
  /** Roughly how long, so the whole list can be honestly totalled. */
  readonly minutes: number
  /** What it costs, if anything. */
  readonly cost: string
}

export interface ContractEntry {
  readonly id: string
  readonly title: string
  readonly requirement: Requirement
  /** What this is FOR, in a sentence a non-engineer can act on. */
  readonly why: string
  /** Which feature it unlocks, for REQUIRED_FOR_FEATURE. */
  readonly feature?: string
  /** How the doctor decides it is satisfied, and how strong that is. */
  readonly verifies: Verification
  /** The command that does it, when software can. */
  readonly automatedBy?: string
  /** Set only when §8's filter genuinely leaves a person in the loop. */
  readonly human?: HumanStep
  /** Ids that must be satisfied first. */
  readonly needs?: readonly string[]
}

/**
 * The contract.
 *
 * Ordered as a person meets them. `fresh:doctor` reports the first unsatisfied
 * entry as THE next action, because a list of eleven things to do is a list
 * nobody starts.
 */
export const CONTRACT: readonly ContractEntry[] = [
  {
    id: 'node',
    title: 'Node.js 22 and npm',
    requirement: 'REQUIRED_FOR_CORE',
    why: 'Everything in this repository runs on it, including the installer.',
    verifies: 'functional',
    automatedBy: 'install Node 22 from https://nodejs.org — or `nvm install 22`',
  },
  {
    id: 'deps',
    title: 'The repository’s dependencies',
    requirement: 'REQUIRED_FOR_CORE',
    why: 'Nothing runs until they are installed. Takes a few seconds.',
    verifies: 'observed',
    automatedBy: 'npm ci',
    needs: ['node'],
  },
  {
    id: 'supabase-project',
    title: 'A Supabase project of your own',
    requirement: 'REQUIRED_FOR_CORE',
    why:
      'This is where the office lives — every project, task, document, job and ' +
      'credential. The free tier is enough: 500MB of database and 1GB of files.',
    verifies: 'functional',
    human: {
      because: 'identity verification',
      steps: [
        'Go to https://supabase.com/dashboard and sign in (GitHub sign-in is quickest).',
        'Press “New project”.',
        'Name it anything you like — “my-team” is fine.',
        'Choose a region near you, and let it generate a database password. You do not need to keep the password: nothing in this setup asks for it.',
        'Choose the Free plan.',
        'Press “Create new project” and wait about two minutes for it to finish provisioning.',
        'When it is ready, look at the browser address bar. It reads https://supabase.com/dashboard/project/XXXXXXXX — that XXXXXXXX is your project reference. Copy it.',
      ],
      minutes: 5,
      cost: 'free',
    },
  },
  {
    id: 'SUPABASE_PROJECT_REF',
    title: 'Tell this repository which project is yours',
    requirement: 'REQUIRED_FOR_CORE',
    why:
      'Every command needs to know which database to talk to. Until you set it, ' +
      'the installer refuses to guess — and it is right to: guessing would mean ' +
      'reaching into somebody else’s.',
    verifies: 'presence',
    automatedBy: 'export SUPABASE_PROJECT_REF=<the reference you copied>',
    needs: ['supabase-project'],
  },
  {
    id: 'SUPABASE_ACCESS_TOKEN',
    title: 'A Supabase access token',
    requirement: 'REQUIRED_FOR_CORE',
    why:
      'How this repository applies the database schema and deploys the office’s ' +
      'functions. It is shown once and never again, which is why a person has to ' +
      'fetch it.',
    verifies: 'functional',
    human: {
      because: 'one-time secret retrieval',
      steps: [
        'Go to https://supabase.com/dashboard/account/tokens',
        'Press “Generate new token”.',
        'Name it “agentic team setup”.',
        'Copy the token immediately — Supabase shows it once and will never show it again.',
        'In your terminal: export SUPABASE_ACCESS_TOKEN=<the token>',
        'Do not paste it into a chat, a file, or a commit.',
      ],
      minutes: 2,
      cost: 'free',
    },
    needs: ['supabase-project'],
  },
  {
    id: 'database',
    title: 'The office’s database',
    requirement: 'REQUIRED_FOR_CORE',
    why:
      'The schema, and the seed that makes the office itself: the eight staff, ' +
      'what each of them is for, which tools exist and what each one may do.',
    verifies: 'observed',
    automatedBy: 'npm run fresh:install',
    needs: ['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', 'deps'],
  },
  {
    id: 'db.project_ref',
    title: 'Tell the office its own address',
    requirement: 'REQUIRED_FOR_CORE',
    why:
      'The office composes URLs about itself — where its MCP server is, where ' +
      'Google should send you back. It will say nothing rather than guess, so ' +
      'until this is set those come out blank.',
    verifies: 'observed',
    automatedBy: 'npm run fresh:configure',
    needs: ['database'],
  },
  {
    id: 'openrouter-key',
    title: 'An OpenRouter API key',
    requirement: 'REQUIRED_FOR_CORE',
    why:
      'This is the office’s ability to think. Without it every member can be ' +
      'asked something and none of them can answer.',
    verifies: 'functional',
    human: {
      because: 'one-time secret retrieval',
      steps: [
        'Go to https://openrouter.ai and sign in.',
        'Go to https://openrouter.ai/keys',
        'Press “Create Key”, name it “agentic team”, and copy it.',
        'You do not have to add credit: the office prefers free models and falls back through several of them.',
        'Store it in your office’s vault (never in a file): npm run fresh:secret -- openrouter.api_key',
        'It will prompt you. The value is not echoed, not logged, and not written to disk.',
      ],
      minutes: 3,
      cost: 'free — free models are the default; paid models are opt-in',
    },
    needs: ['database'],
  },
  {
    id: 'hq-token',
    title: 'The office’s own API token',
    requirement: 'REQUIRED_FOR_CORE',
    why:
      'One bearer token guards everything the office exposes over HTTP. It is ' +
      'generated for you — you never choose it and never type it.',
    verifies: 'observed',
    automatedBy: 'npm run fresh:configure',
    needs: ['database'],
  },
  {
    id: 'worker',
    title: 'The worker',
    requirement: 'REQUIRED_FOR_CORE',
    why:
      'The part that actually does the work: it takes a job off the queue, ' +
      'chooses who should answer, asks them, and writes down what they said.',
    verifies: 'functional',
    automatedBy: 'npm run deploy:worker',
    needs: ['database', 'openrouter-key'],
  },
  {
    id: 'hq-api',
    title: 'The office’s HTTP gateway',
    requirement: 'REQUIRED_FOR_CORE',
    why: 'How anything outside the database reads or writes the office — including you.',
    verifies: 'functional',
    automatedBy: 'npm run deploy:hq',
    needs: ['database', 'hq-token'],
  },
  {
    id: 'telegram-bot',
    title: 'A Telegram bot to talk to',
    requirement: 'REQUIRED_FOR_FEATURE',
    feature: 'talking to the office from your phone — the simplest first surface',
    why:
      'One bot, not eight. This is the Chief of Staff, and she is the only one ' +
      'who messages you; everybody else still does the work and writes it down.',
    verifies: 'functional',
    human: {
      because: 'provider policy',
      steps: [
        'Open Telegram and search for @BotFather (he has a blue tick).',
        'Send him: /newbot',
        'He asks for a display name. Anything: “My Chief of Staff”.',
        'He asks for a username. It must end in “bot” — for example my_chief_of_staff_bot. If it is taken he will say so; try another.',
        'He replies with a line reading “Use this token to access the HTTP API:” followed by the token. Copy it.',
        'Store it: npm run fresh:secret -- telegram.chief.bot_token',
        'Then: npm run telegram:configure — this registers the bot, points Telegram at your office, and verifies it by asking Telegram who the bot is.',
      ],
      minutes: 4,
      cost: 'free',
    },
    needs: ['database'],
  },
  {
    id: 'first-use',
    title: 'Your first real instruction',
    requirement: 'REQUIRED_FOR_CORE',
    why:
      'Setup is not finished when the configuration is complete. It is finished ' +
      'when you have asked the office something and it has answered.',
    verifies: 'functional',
    automatedBy: 'npm run fresh:first-use',
    needs: ['worker', 'hq-api'],
  },

  // ---------------------------------------------------------------------
  // Everything below here is genuinely optional. None of it may block core.
  // ---------------------------------------------------------------------
  {
    id: 'web-dashboard',
    title: 'The web dashboard',
    requirement: 'OPTIONAL',
    feature: 'seeing the office in a browser rather than only messaging it',
    why:
      'A second surface, not a required one. The office is fully usable from ' +
      'Telegram alone, and the dashboard needs a Vercel account to host.',
    verifies: 'functional',
    automatedBy: 'npm run deploy:page',
    needs: ['hq-api'],
  },
  {
    id: 'slack',
    title: 'Slack',
    requirement: 'OPTIONAL',
    feature: 'a channel per project, and talking to the office from Slack',
    why: 'Useful if you already live in Slack. Nothing else depends on it.',
    verifies: 'functional',
    human: {
      because: 'consent',
      steps: [
        'Go to https://api.slack.com/apps and press “Create New App” → “From an app manifest”.',
        'Choose the workspace you want the office in.',
        'Give it a name, choose the workspace, and paste the manifest from docs/slack-app-status.md.',
        'Press “Install to Workspace” and approve the permissions.',
        'From “OAuth & Permissions”, copy the Bot User OAuth Token (it starts xoxb-).',
        'Store it: npm run fresh:secret -- slack.bot_token',
        'From “Basic Information”, copy the Signing Secret and store it: npm run fresh:secret -- slack.signing_secret',
        'Then: npm run deploy:slack',
      ],
      minutes: 10,
      cost: 'free',
    },
    needs: ['database'],
  },
  {
    id: 'google',
    title: 'Google — Calendar, Gmail, Drive',
    requirement: 'OPTIONAL',
    feature: 'the office reading your diary, your mail and your documents',
    why:
      'It lets the team answer questions about your week and cite your own ' +
      'files. It can never send mail: that is off by policy, whatever the ' +
      'permission allows.',
    verifies: 'functional',
    human: {
      because: 'consent',
      steps: [
        'This one is genuinely fiddly and takes about twenty minutes.',
        'Follow docs/google-cloud-tts-credential.md, which has the console steps in order.',
        'Then: npm run deploy:google — it deploys the OAuth callback your office needs.',
        'Then press Connect on the office’s Settings page.',
      ],
      minutes: 20,
      cost: 'free',
    },
    needs: ['hq-api', 'db.project_ref'],
  },
  {
    id: 'notion',
    title: 'Notion',
    requirement: 'OPTIONAL',
    feature: 'mirroring the office’s documents into a Notion database',
    why: 'Only if you want the output somewhere you already read.',
    verifies: 'functional',
    human: {
      because: 'consent',
      steps: [
        'Go to https://www.notion.so/my-integrations and press “New integration”.',
        'Name it “Agentic Team”, choose your workspace, and press Save.',
        'Copy the Internal Integration Secret.',
        'Store it: npm run fresh:secret -- notion.integration_token',
        'In Notion, open the page you want the office to write under, press the ⋯ menu → Connections → and add your integration.',
      ],
      minutes: 5,
      cost: 'free',
    },
    needs: ['database'],
  },
  {
    id: 'voice',
    title: 'Talking to the office out loud',
    requirement: 'OPTIONAL',
    feature: 'a spoken conversation with the Chief of Staff',
    why:
      'This is the one part that genuinely costs money: it uses OpenAI’s realtime ' +
      'voice API, which has no free tier. Everything else here is free.',
    verifies: 'functional',
    human: {
      because: 'payment',
      steps: [
        'Go to https://platform.openai.com/api-keys and create a key.',
        'You must add a payment method — the realtime voice API has no free tier.',
        'Store it: npm run fresh:secret -- openai.api_key',
        'Then: npm run deploy:voice',
      ],
      minutes: 5,
      cost: 'paid — OpenAI realtime pricing, roughly a few pence per minute of conversation',
    },
    needs: ['hq-api'],
  },
  {
    id: 'backups',
    title: 'Off-site backups',
    requirement: 'OPTIONAL',
    feature: 'a copy of the office somewhere other than Supabase',
    why:
      'Worth doing once the office holds something you would miss. Not worth ' +
      'doing before your first conversation with it.',
    verifies: 'functional',
    automatedBy: 'npm run bootstrap:backup-credentials',
    needs: ['database'],
  },
]

/** Everything the minimum viable install needs, in the order a person meets it. */
export const CORE: readonly ContractEntry[] = CONTRACT.filter(
  (e) => e.requirement === 'REQUIRED_FOR_CORE',
)

/**
 * The genuine human minutes, and what they cost.
 *
 * Totalled from the contract rather than estimated in prose, so the number in
 * the documentation cannot drift away from the number of steps.
 */
export function humanEffort(entries: readonly ContractEntry[] = CORE): {
  readonly minutes: number
  readonly steps: number
} {
  const human = entries.filter((e) => e.human !== undefined)
  return {
    minutes: human.reduce((n, e) => n + (e.human?.minutes ?? 0), 0),
    steps: human.reduce((n, e) => n + (e.human?.steps.length ?? 0), 0),
  }
}

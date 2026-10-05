/**
 * The production REQUEST BUDGET (a PROPOSAL, docs/testing/production-test-budgets.md).
 *
 * The production gate (`production-gate.ts`) decides INTENT: was a person asked. It has no notion of VOLUME, and the
 * evidence is that volume is what hurts the 434 MiB Nano host: 2,300 to 3,000 gateway requests in ten minutes preceded
 * every persistent degradation episode (docs/ops/supabase-forensics-2026-10-05.md sections 3 and 12.3), and one Team HQ
 * page load is about 25 gateway requests. So a process that is allowed to reach production is also allowed only so many
 * requests, by class, and the number is stated when it is raised.
 *
 * What counts: every request the fetch guard lets through to a production host (`*.supabase.co`, `*.supabase.com`,
 * `*.vercel.app`, the project ref), every Management API query (one per attempt, retries included), every remote Postgres
 * statement, and the requests a browser page makes to production hosts (`page-accounting.ts`). What does not: localhost,
 * a Unix-socket replica, a request the gate REFUSED (nothing was sent), and anything in Deno (the edge worker is the
 * production office; this protects the build sessions and operators, never the office itself).
 *
 * Where it applies: a Node process started from `scripts/`, or any process that sets HQ_PRODUCTION_REQUEST_BUDGET. A unit
 * test importing a helper is not a command and is not budgeted unless it builds its own `ProductionBudget`.
 *
 *   class                 requests  page loads
 *   smoke                      100       5
 *   sample                     250      20
 *   disposable-multi-user      400      20
 *   production-heavy           200      10
 *   p4-browser                 500      40
 *   default (unclassified)     150      10
 *
 * `HQ_PRODUCTION_REQUEST_BUDGET=<n>` may LOWER the number freely. Raising it above the class default is refused unless
 * `HQ_PRODUCTION_BUDGET_REASON=<text>` says why; the reason is printed, never silently accepted. The same two variables
 * with `HQ_PRODUCTION_PAGE_LOAD_BUDGET` govern page loads. The class is `HQ_SUITE_CLASS` (set by scripts/suite.ts) or, when
 * absent, derived from the entry script (scripts/p4 is p4-browser; anything else is default).
 *
 * On exceeding it the process: prints a sentence naming the budget, the count and the class; sets exit code 5; runs the
 * teardowns the harness registered (`registerBudgetTeardown`), which get a small bounded allowance of their own so a
 * cleanup can still reach the office; then refuses every later production request for good. The refused request throws
 * `ProductionBudgetExceeded`, so the script's own `finally` also runs. A script that swallows the throw cannot continue:
 * its next request is refused too.
 *
 * This file imports nothing so the Deno bundle that carries `production-gate.ts` has nothing to resolve; it reaches the
 * environment, `process` and `node:async_hooks` only through `globalThis`.
 */

export type BudgetClass =
  | 'smoke'
  | 'sample'
  | 'disposable-multi-user'
  | 'production-heavy'
  | 'p4-browser'
  | 'default'

export const BUDGET_CLASSES: Record<BudgetClass, { requests: number; pageLoads: number }> = {
  smoke: { requests: 100, pageLoads: 5 },
  sample: { requests: 250, pageLoads: 20 },
  'disposable-multi-user': { requests: 400, pageLoads: 20 },
  'production-heavy': { requests: 200, pageLoads: 10 },
  'p4-browser': { requests: 500, pageLoads: 40 },
  default: { requests: 150, pageLoads: 10 },
}

export const ENV_BUDGET = 'HQ_PRODUCTION_REQUEST_BUDGET'
export const ENV_PAGE_BUDGET = 'HQ_PRODUCTION_PAGE_LOAD_BUDGET'
export const ENV_REASON = 'HQ_PRODUCTION_BUDGET_REASON'
export const ENV_CLASS = 'HQ_SUITE_CLASS'

/** What a teardown may still send after the budget is spent. Bounded, so a cleanup cannot become a second run. */
export const TEARDOWN_ALLOWANCE = 50

/** A stated reason shorter than this is not a reason. */
const MIN_REASON = 8

type Env = Record<string, string | undefined>

export class ProductionBudgetRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionBudgetRefused'
  }
}

export class ProductionBudgetExceeded extends Error {
  readonly used: number
  readonly limit: number
  readonly cls: BudgetClass
  constructor(message: string, used: number, limit: number, cls: BudgetClass) {
    super(message)
    this.name = 'ProductionBudgetExceeded'
    this.used = used
    this.limit = limit
    this.cls = cls
  }
}

export type BudgetPlan = {
  readonly cls: BudgetClass
  readonly limit: number
  readonly pageLoadLimit: number
  readonly defaultLimit: number
  /** Present only when a number above the class default was configured, with the reason given for it. */
  readonly raised: { readonly what: 'requests' | 'page loads'; readonly reason: string }[]
}

const isClass = (v: string | undefined): v is BudgetClass =>
  v !== undefined && Object.hasOwn(BUDGET_CLASSES, v)

/** The class of a process: stated by the runner, otherwise by where the entry script lives. `local` touches no production. */
export const classOf = (env: Env, argv1: string | undefined): BudgetClass => {
  const stated = (env[ENV_CLASS] ?? '').trim()
  if (isClass(stated)) return stated
  if (argv1 !== undefined && /(^|[\\/])scripts[\\/]p4[\\/]/.test(argv1)) return 'p4-browser'
  return 'default'
}

const parseCount = (name: string, raw: string): number => {
  if (!/^[1-9]\d{0,8}$/.test(raw.trim()))
    throw new ProductionBudgetRefused(
      `REFUSED: ${name}=${JSON.stringify(raw)} is not a positive whole number. Nothing was sent.`,
    )
  return Number(raw.trim())
}

/**
 * Pure. The numbers a process will run under, or a refusal. A lower number is always accepted; a higher one is accepted
 * only with a stated reason, and an unreadable one is refused rather than ignored (an ignored typo is a default the person
 * did not choose).
 */
export const planBudget = (env: Env, cls: BudgetClass): BudgetPlan => {
  const base = BUDGET_CLASSES[cls]
  const reason = (env[ENV_REASON] ?? '').trim()
  const raised: { what: 'requests' | 'page loads'; reason: string }[] = []
  const pick = (name: string, fallback: number, what: 'requests' | 'page loads'): number => {
    const raw = env[name]
    if (raw === undefined || raw === '') return fallback
    const n = parseCount(name, raw)
    if (n <= fallback) return n
    if (reason.length < MIN_REASON)
      throw new ProductionBudgetRefused(
        `REFUSED: ${name}=${n} raises the ${what} budget above the ${cls} class default of ${fallback}. ` +
          `Say why, in words, with ${ENV_REASON}="<why this run needs more>" (at least ${MIN_REASON} characters). ` +
          'The reason is printed. Lowering the number needs no reason. Nothing was sent.',
      )
    raised.push({ what, reason })
    return n
  }
  return {
    cls,
    limit: pick(ENV_BUDGET, base.requests, 'requests'),
    pageLoadLimit: pick(ENV_PAGE_BUDGET, base.pageLoads, 'page loads'),
    defaultLimit: base.requests,
    raised,
  }
}

type AsyncLocal = { run<T>(store: boolean, fn: () => T): T; getStore(): boolean | undefined }

const makeLocal = (): AsyncLocal | null => {
  try {
    const g = globalThis as {
      process?: { getBuiltinModule?: (id: string) => unknown }
    }
    const mod = g.process?.getBuiltinModule?.('node:async_hooks') as
      | { AsyncLocalStorage: new () => AsyncLocal }
      | undefined
    return mod === undefined ? null : new mod.AsyncLocalStorage()
  } catch {
    return null
  }
}

export type BudgetOptions = {
  /** Where messages go (default: stderr). */
  readonly write?: (line: string) => void
  /** Called with the exit code on a breach (default: sets process.exitCode). */
  readonly setExitCode?: (code: number) => void
}

export class ProductionBudget {
  readonly plan: BudgetPlan
  private requests = 0
  private loads = 0
  private spent = false
  private breaching: Promise<void> | null = null
  private teardownSent = 0
  private readonly teardowns: (() => unknown)[] = []
  private readonly local = makeLocal()
  private readonly write: (line: string) => void
  private readonly setExitCode: (code: number) => void

  constructor(plan: BudgetPlan, opts: BudgetOptions = {}) {
    this.plan = plan
    this.write =
      opts.write ??
      ((line) => {
        const p = (globalThis as { process?: { stderr?: { write(s: string): unknown } } }).process
        p?.stderr?.write(`${line}\n`)
      })
    this.setExitCode =
      opts.setExitCode ??
      ((code) => {
        const p = (globalThis as { process?: { exitCode?: number } }).process
        if (p !== undefined) p.exitCode = code
      })
  }

  /** Requests made so far (refused ones are not made, so not counted). */
  get used(): number {
    return this.requests
  }
  get pageLoads(): number {
    return this.loads
  }
  get exceeded(): boolean {
    return this.spent
  }

  /** The one line printed at start-up, so a raised budget is never silent. */
  describe(): string {
    const raised = this.plan.raised.map((r) => ` RAISED (${r.what}) because: ${r.reason}`).join('')
    return (
      `[request-budget] class ${this.plan.cls}: at most ${this.plan.limit} production requests and ` +
      `${this.plan.pageLoadLimit} page loads in this run.${raised}`
    )
  }

  /** Register a cleanup to run if the budget is spent. It may still send `TEARDOWN_ALLOWANCE` requests. */
  registerTeardown(fn: () => unknown): void {
    this.teardowns.push(fn)
  }

  private inTeardown(): boolean {
    return this.local?.getStore() === true
  }

  private message(what: string): string {
    return (
      `ABORTED: the production request budget of ${this.plan.limit} for class "${this.plan.cls}" is spent ` +
      `(${this.requests} requests made, ${this.loads} page loads; refused: ${what}). ` +
      'Verification traffic of this volume preceded every degradation episode of the production host ' +
      '(docs/testing/production-test-budgets.md). Teardown has been run. ' +
      `To run more on purpose, raise it and say why: ${ENV_BUDGET}=<n> ${ENV_REASON}="<why>". Nothing further was sent.`
    )
  }

  private error(what: string): ProductionBudgetExceeded {
    return new ProductionBudgetExceeded(
      this.message(what),
      this.requests,
      this.plan.limit,
      this.plan.cls,
    )
  }

  private breach(what: string): Promise<void> {
    if (this.breaching !== null) return this.breaching
    this.spent = true
    this.setExitCode(5)
    this.write(this.message(what))
    const run = async (): Promise<void> => {
      for (const fn of this.teardowns) {
        try {
          const call = (): unknown => fn()
          await (this.local === null ? call() : this.local.run(true, call))
        } catch (e) {
          this.write(`[request-budget] a teardown failed: ${(e as Error)?.message ?? String(e)}`)
        }
      }
    }
    this.breaching = run()
    return this.breaching
  }

  /**
   * Ask to make one production request. Resolves when it may be sent and counts it; throws `ProductionBudgetExceeded`
   * (after running the teardowns, once) when it may not. A refused request is not counted.
   */
  async admit(what: string): Promise<void> {
    if (this.inTeardown()) {
      if (this.teardownSent >= TEARDOWN_ALLOWANCE)
        throw this.error(`${what} (teardown allowance spent)`)
      this.teardownSent += 1
      this.requests += 1
      return
    }
    if (this.spent) {
      await this.breaching
      throw this.error(what)
    }
    if (this.requests + 1 > this.plan.limit) {
      await this.breach(what)
      throw this.error(what)
    }
    this.requests += 1
  }

  /**
   * Synchronous accounting for a request that has ALREADY happened (a browser page's own traffic). Returns false when it
   * took the count past the budget, and starts the breach (teardown) in the background.
   */
  tally(what: string): boolean {
    this.requests += 1
    if (this.requests > this.plan.limit) {
      void this.breach(what)
      return false
    }
    return !this.spent
  }

  /** Count a main-frame page load. Returns false past the page-load budget (and starts the breach). */
  tallyPageLoad(what: string): boolean {
    this.loads += 1
    if (this.loads > this.plan.pageLoadLimit) {
      void this.breach(`page load ${what}`)
      return false
    }
    return !this.spent
  }
}

const processEnv = (): Env | null => {
  const g = globalThis as { Deno?: unknown; process?: { env?: Env } }
  if (g.Deno !== undefined) return null
  return g.process?.env ?? null
}

const SCRIPT = /(^|[\\/])scripts[\\/].+\.(ts|mts|js|mjs|cjs)$/

let singleton: ProductionBudget | null | undefined

/**
 * The process's budget, or null where none applies (Deno, a unit test that is not a command). Built on first use; throws
 * `ProductionBudgetRefused` for an unreadable or unexplained configuration.
 */
export const productionBudget = (): ProductionBudget | null => {
  if (singleton !== undefined) return singleton
  const env = processEnv()
  const argv1 = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1]
  const isCommand = argv1 !== undefined && SCRIPT.test(argv1)
  if (env === null || (!isCommand && (env[ENV_BUDGET] ?? '') === '')) {
    singleton = null
    return null
  }
  const built = new ProductionBudget(planBudget(env, classOf(env, argv1)))
  singleton = built
  const g = globalThis as { process?: { stderr?: { write(s: string): unknown } } }
  if (built.plan.raised.length > 0) g.process?.stderr?.write(`${built.describe()}\n`)
  return built
}

/** Validates the configuration now, so a refused one stops the command before it does anything. */
export const initProductionBudget = (): ProductionBudget | null => productionBudget()

/** Register a teardown with the process budget, if there is one (a harness calls this once it has something to clean). */
export const registerBudgetTeardown = (fn: () => unknown): void => {
  productionBudget()?.registerTeardown(fn)
}

/** Count one production request against the process budget, if there is one. */
export const admitProductionRequest = async (what: string): Promise<void> => {
  await productionBudget()?.admit(what)
}

/** For tests: forget the process budget so the next call builds a fresh one from the environment. */
export const resetProductionBudgetForTest = (): void => {
  singleton = undefined
}

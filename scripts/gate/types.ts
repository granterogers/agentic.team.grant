/**
 * The shape of one registered proof. A proof is registered in EXACTLY ONE of the four registries beside this file
 * (critical.ts, extended.ts, quarantine.ts, helpers.ts) and adding one is a single line there: see docs/testing/CRITICAL-GATE.md.
 */

/** How the runner prepares a database for the proof and starts it. */
export type Kind =
  /** `tsx scripts/isolated/<file>.ts <clone>`: a fresh clone of the candidate schema, dropped afterwards. The default. */
  | 'ts'
  /** The P2 ownership attack suite: `p2-attack.sh` builds a clone named p2_attack_*, then `<file>.ts <clone>` attacks it. */
  | 'p2'
  /** The P3 application attack suite: `p3-attack.sh` builds a clone named p3_attack_*, then `<file>.ts <clone>`. */
  | 'p3'
  /** A bash script that builds and drops its own databases from templates it is GIVEN (GATE_DB_PREFIX, ISOLATED_POST). */
  | 'script'
  /** A `.sql` proof run with psql on a fresh clone. */
  | 'sql'
  /** The backfill plants: builds its own working database from the pre-0654 template the runner prepares. */
  | 'plants'
  /** The composite-FK spike: a clone named fk_spike_* of the pre-0654 template (the schema BEFORE the offices existed). */
  | 'fk'

export interface Proof {
  /** The registry key, and the file name under scripts/isolated/ unless `file` says otherwise. Unique across all registries. */
  readonly name: string
  /** ONE line: which invariant this proof guards (or, for a quarantined one, why it is out). */
  readonly why: string
  /** The fewest assertions this proof may report and still count as having run. About 80% of what it reports today. */
  readonly min: number
  readonly kind?: Kind
  /** Path under scripts/isolated/ without the extension, when it differs from `name`. */
  readonly file?: string
  /** Extra command-line arguments after the database name. */
  readonly args?: readonly string[]
  /** Which database to clone: the candidate (default), or the older replica generations a control needs. */
  readonly template?: 'cand' | 'pre' | 'base'
  /** A line that counts as one passed assertion (default: a line starting `ok` or `PROVEN`). */
  readonly okRe?: string
  /** A line that counts as one failed assertion (default: a line starting `FAIL` or `FAILED`). */
  readonly failRe?: string
  /** The exit code that means success (default 0). A psql proof that ends in a deliberate PROOF_OK exception exits 3. */
  readonly okRc?: number
  /** This driver prints findings and not assertions; it still must exit 0, and zero assertions is not a defect. */
  readonly informational?: boolean
  /** Seconds before the runner stops the proof (default 480). */
  readonly timeoutS?: number
  /** Environment for the child, merged over the gate's own. */
  readonly env?: Readonly<Record<string, string>>
}

export interface Quarantined extends Proof {
  /** What replaced it (a proof name, a runner mode, or "nothing: <the gap>"). Said plainly, never left blank. */
  readonly replacedBy: string
}

export type Tier = 'critical' | 'extended'

export interface Verdict {
  readonly ok: boolean
  /** PASS, RED, CRASHED (it died before asserting anything), NO-ASSERTIONS, TIMEOUT, BELOW-FLOOR. */
  readonly label: 'PASS' | 'RED' | 'CRASHED' | 'NO-ASSERTIONS' | 'TIMEOUT' | 'BELOW-FLOOR'
  readonly pass: number
  readonly fail: number
  readonly reason: string
}

// biome-ignore-all format: a dense arithmetic table kept readable as written
/**
 * What the unified activity ledger adds to the database, as arithmetic anybody can rerun. No database is contacted, no production access.
 *
 *   npm run activity:storage [headroom-MB] [existing-growth-MB-a-day]
 *
 * Every constant is labelled: MEASURED on the isolated replica with the final candidate schema (scripts/isolated/activity-storage.ts),
 * RECORDED from a production reading already in this repository (the file and date are named), or ASSUMED. The recorded production
 * readings are old; the baseline step of the runbook replaces them with a current one and this script is then run with that headroom.
 * docs/activity-ledger/STORAGE-CAPACITY-DECISION.md holds the reasoning and the decision.
 */

// ---- what a native event costs (MEASURED, activity-storage, 4 000 events a kind) ----------------------------------------------------
const EVENT = { typical: 742, withLinks: 797, external: 780, largest: 1371, planning: 850 } // bytes with heap and indexes; TOAST was 0 in every case

// ---- the eleven read indexes on tables that already exist ----------------------------------------------------------------------------
// MEASURED bytes of index per row of the table (unique timestamps, concurrent build): transitions 23.3, model calls 43.0, deliveries 3 x 48.6,
// outputs 33.7. ASSUMED for tables with no rows in the replica: events and inbound commands (office, time) 45, blockers 45, impediments 30.
const INDEX_BYTES_PER_ROW = { job_state_transitions: 23.3, inference_usage: 43.0, deliveries: 145.9, outputs: 33.7, events: 45, inbound_commands: 45, blockers: 45, job_impediments: 30 }
// RECORDED row counts: the LIVE production reading of 12 October 2026 08:12 UTC (docs/activity-ledger/PRODUCTION-BASELINE-2026-10-12.md, Q07: planner estimates
// from pg_stat_user_tables), read through the read-only endpoint under approval A3. The 11 October capacity audit scaled older counts instead (transitions 146 893).
const ROWS = { job_state_transitions: 169_922, deliveries: 4_678, inference_usage: 16_905, outputs: 18_715, events: 14_514, inbound_commands: 4_570, blockers: 1_229, job_impediments: 2_347 }
const indexBytes = (Object.keys(INDEX_BYTES_PER_ROW) as (keyof typeof ROWS)[]).reduce((a, k) => a + ROWS[k] * INDEX_BYTES_PER_ROW[k], 0)
const MIGRATION_BYTES = 260_000 // MEASURED: pg_database_size delta of applying 1060 to 1062 (empty tables and indexes, function bodies)

const mb = (b: number) => b / 1_000_000
const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2))
const headroom = Number(process.argv[2] ?? 118.5) // MB; RECORDED 12 October 2026 08:12 UTC: 381 521 043 bytes used of 500 MB decimal (live read, Q01)
const existing = Number(process.argv[3] ?? 2.2) // MB a day; RECORDED 9 to 12 October: 374.80 to 381.52 MB = +6.72 MB in about 3 days (capacity_samples: 378.6, 380.9, 381.5 MB on 10, 11, 12 October). The earlier 0.75 a day (5 to 9 October) understated it.

console.log(`headroom ${headroom} MB, growth of everything else ${existing} MB a day\n`)
console.log(`A. one-off cost`)
console.log(`   the three migrations: ${fmt(mb(MIGRATION_BYTES))} MB (measured)`)
console.log(`   the eleven read indexes on today's recorded row counts: ${fmt(mb(indexBytes))} MB (range ${fmt(mb(indexBytes * 0.7))} to ${fmt(mb(indexBytes * 1.5))}; the earlier 21 MB was inferred from table BYTES, which are inflated by bloat in the update-heavy tables, not from row counts)`)
console.log(`   WAL written while building them: about the same as their size, transient; temp files none (every index sorts inside maintenance_work_mem, 32 MB on the recorded host)`)
const oneOff = mb(indexBytes + MIGRATION_BYTES)

// ---- event emission paths (read from the code) --------------------------------------------------------------------------------------
console.log(`\nB. where native events come from (src/agents/perform.ts, src/jobs/worker.ts, migration 1062, the outside-worker door)`)
console.log(`   executed plan step with a capability: 2 events (requested, then completed or failed); a retry of the step writes the same keys, so no more`)
console.log(`   a stalled job reclaimed by the sweep: 1 event a job and attempt;  budget threshold: at most 1 a day an office and agent`)
console.log(`   an outside worker's report: 1 each, capped at 300 an hour a worker, 1 000 an hour and 4 000 a day an office;  nothing else writes a native row`)
console.log(`   so events a day = 2 x executed plan steps + reclaimed jobs + thresholds + external reports. A message or a task alone writes none (the read model reads their own rows).`)
console.log(`   RECORDED ceiling for the current deployment: executed plan steps a day, every office and every harness job counted, were 142 to 163 on each of 2 to 11 October 2026 (live read Q10, 12 October), so at most about 330 events a day across the whole deployment; one canary office is a fraction of that`)

// ---- the requested grid -------------------------------------------------------------------------------------------------------------
const rates = [100, 250, 500, 1000, 2000, 5000]
const days = [30, 90, 180, 365]
console.log(`\nC. native event storage by rate and horizon (MB, ${EVENT.withLinks} B an event central; ${EVENT.typical} to ${EVENT.largest} B range in brackets for 365 days)`)
console.log(`   ${'events a day'.padEnd(14)}${days.map((d) => `${d} days`.padStart(12)).join('')}${'365 d range'.padStart(18)}`)
for (const r of rates) {
  console.log(`   ${String(r).padEnd(14)}${days.map((d) => fmt(mb(r * d * EVENT.withLinks)).padStart(12)).join('')}${`(${fmt(mb(r * 365 * EVENT.typical))} to ${fmt(mb(r * 365 * EVENT.largest))})`.padStart(18)}`)
}
console.log(`   the diagnostic cap (500 a day an office) bounds tool-call events; consequential and outside-worker events are not under it`)

// ---- scenarios against the headroom -------------------------------------------------------------------------------------------------
type S = { name: string; offices: number; perOffice: number; low: number; high: number }
const scenarios: S[] = [
  { name: 'current single user (about 100 a day; 25 to 330)', offices: 1, perOffice: 100, low: 25, high: 330 },
  { name: 'heavier autonomous operation (500 a day, at the cap; 300 to 1 000)', offices: 1, perOffice: 500, low: 300, high: 1000 },
  { name: 'two active offices (the recorded count), 250 each (100 to 500)', offices: 2, perOffice: 250, low: 100, high: 500 },
  { name: 'external workers and Hermes added: 500 + 500 reports a day (300 to 4 500)', offices: 1, perOffice: 1000, low: 600, high: 4500 },
  { name: 'five offices at 250 a day (a future multi-user case)', offices: 5, perOffice: 250, low: 100, high: 500 },
]
console.log(`\nD. against ${headroom} MB of headroom, after the ${fmt(oneOff)} MB one-off cost, with everything else growing ${existing} MB a day (and ${fmt(existing * 10)} MB a day as a stress case)`)
console.log(`   ${'scenario'.padEnd(74)}${'MB/day'.padStart(8)}${'90 d'.padStart(8)}${'365 d'.padStart(8)}${'days to full'.padStart(14)}${'(range)'.padStart(14)}${'days if +10x'.padStart(14)}${'share'.padStart(8)}`)
const without = (headroom - mb(MIGRATION_BYTES)) / existing // the existing growth alone, with no ledger at all
for (const s of scenarios) {
  const per = (rate: number) => mb(rate * s.offices * EVENT.withLinks)
  const d = per(s.perOffice)
  const toFull = (rate: number, grow: number) => (headroom - oneOff) / (per(rate) + grow)
  console.log(`   ${s.name.padEnd(74)}${fmt(d).padStart(8)}${fmt(d * 90).padStart(8)}${fmt(d * 365).padStart(8)}${toFull(s.perOffice, existing).toFixed(0).padStart(14)}${`${toFull(s.high, existing).toFixed(0)}-${toFull(s.low, existing).toFixed(0)}`.padStart(14)}${toFull(s.perOffice, existing * 10).toFixed(0).padStart(14)}${`${((d / (d + existing)) * 100).toFixed(0)}%`.padStart(8)}`)
}
console.log(`   with NO ledger at all, the other growth alone fills ${headroom} MB in ${without.toFixed(0)} days; "share" is the ledger's part of total growth. At the current office the ledger moves that date by weeks; the existing tables' own growth dominates unless several offices or heavy outside-worker reporting are added.`)
console.log(`   "days to full" = (headroom - one-off) / (ledger MB a day + other growth MB a day), before any optimisation and before the platform's own overhead`)

// ---- the gate ------------------------------------------------------------------------------------------------------------------------
const canary90 = mb(250 * 90 * EVENT.withLinks)
const gate = (oneOff + canary90) * 1.25
console.log(`\nE. the runbook's safety gate for a canary: one-off ${fmt(oneOff)} MB + 90 days at 250 a day ${fmt(canary90)} MB, plus 25 percent = ${fmt(gate)} MB (the first runbook said about 65 MB, computed from an inferred 21 MB; the measured need is ${fmt(gate)} MB). The gate covers the ledger only: ADD the other growth over the observation window (${fmt(existing * 30)} MB for 30 days at ${existing} MB a day) to see the runway`)
console.log(`   index build transient: the old files are not touched, so the build adds only the new indexes; WAL is transient and the recorded max_wal_size is 1 GB on a 2 GB volume`)

// ---- the ledger's effect on FILE storage, through the nightly backup ------------------------------------------------------------------
// The backup is whole tables as rows (no indexes), and it discovers tables itself, so the ledger's tables are in it from the first night. RECORDED: 153 259 rows
// were 12.5 MB (docs/ops/evidence/backup-restore-rpo-rto.md), about 82 bytes a row compressed. Archive n holds every row to date, so a ledger row written on
// day d is in every archive from d on: with R rows a day the archive on night n holds n x R ledger rows.
const ARCHIVE_BYTES_PER_ROW = 82
console.log(`\nF. the ledger's effect on the 1 GB FILE storage allowance (not the database): ${ARCHIVE_BYTES_PER_ROW} B a row in every nightly archive that is kept`)
console.log(`   ${'events a day'.padEnd(14)}${'archive on night 90'.padStart(22)}${'sum of 90 nights, none deleted'.padStart(34)}${'15 kept (7 daily + 8 weekly)'.padStart(34)}`)
for (const r of [100, 250, 500, 1000]) {
  const night90 = mb(r * 90 * ARCHIVE_BYTES_PER_ROW)
  const sumAll = mb(ARCHIVE_BYTES_PER_ROW * r * ((90 * 91) / 2))
  const kept = mb(ARCHIVE_BYTES_PER_ROW * r * (7 * 90 - 21 + 8 * (90 - 28)))
  console.log(`   ${String(r).padEnd(14)}${`${fmt(night90)} MB`.padStart(22)}${`${fmt(sumAll)} MB`.padStart(34)}${`${fmt(kept)} MB`.padStart(34)}`)
}
console.log(`   so at 250 a day the ledger adds about ${fmt(mb(ARCHIVE_BYTES_PER_ROW * 250 * 90))} MB to each nightly archive after 90 days, and, because backups are never deleted today, about ${fmt(mb(ARCHIVE_BYTES_PER_ROW * 250 * ((90 * 91) / 2)))} MB of file storage in total: a larger effect on the 1 GB allowance than the 18 MB it takes of the database. With the retention policy that npm run backup:prune applies it is about ${fmt(mb(ARCHIVE_BYTES_PER_ROW * 250 * (7 * 90 - 21 + 8 * (90 - 28))))} MB.`)

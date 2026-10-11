// biome-ignore-all format: a dense arithmetic table kept readable as written
/**
 * What the unified activity ledger adds to the database, as arithmetic anybody can rerun (phase 8). No database is contacted.
 *
 *   npx tsx scripts/ops/activity-storage-forecast.ts [headroom-MB]
 *
 * Every constant is either MEASURED on the isolated replica (the run that produced it is named) or ASSUMED (and says so). Nothing here is
 * a production figure: the production database size, row counts and event rates are read by the baseline step of the runbook, and the
 * answer there replaces the assumptions below.
 */

const MEASURED = {
  // 20 000 events written through the strict writer with a tool-call payload (a 60 to 80 character summary, four metadata keys), no
  // project and no job: heap 400.2 B a row, indexes 347.3 B a row, TOAST 0 (rows stay far below the 2 KB threshold). 749.6 B in all.
  eventBytesNoLinks: 750,
  // A project and a job each add an entry to two partial indexes (about 35 to 60 B a row between them). Planning figure, rounded up.
  eventBytesWithLinks: 850,
  // The eleven read indexes on the source tables, with unique timestamps (REINDEX after randomising the time columns, so the btree is
  // not deduplicated by the replica's cloned timestamps): bytes per ROW of the table they index.
  indexBytesPerRow: { job_state_transitions: 22.6, inference_usage: 40.9, deliveries: 3 * 41.4, outputs: 23.3 },
}

// ASSUMED, from the sizes and average row widths RECORDED in docs/ops/capacity-scenarios-2026-10-06.md (5 October 2026):
// rows ~ table bytes / replica bytes-per-row. INFERRED, and wrong by the ratio of production's row width to the replica's.
const RECORDED_ROWS = { job_state_transitions: 187_000, inference_usage: 95_000, deliveries: 37_000, outputs: 5_000, events: 167_000, inbound_commands: 29_000 }
const OTHER_INDEX_BYTES_PER_ROW = 40 // events and inbound_commands: (office_id uuid, time) entries, no dedup of time

const mb = (b: number) => b / 1_000_000
const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2))
const headroom = Number(process.argv[2] ?? 100)

// ---- 1. the eleven read indexes: a one-time cost, then growth with the tables they index --------------------------------------------
const idx =
  RECORDED_ROWS.job_state_transitions * MEASURED.indexBytesPerRow.job_state_transitions +
  RECORDED_ROWS.inference_usage * MEASURED.indexBytesPerRow.inference_usage +
  RECORDED_ROWS.deliveries * MEASURED.indexBytesPerRow.deliveries +
  RECORDED_ROWS.outputs * MEASURED.indexBytesPerRow.outputs +
  (RECORDED_ROWS.events + RECORDED_ROWS.inbound_commands) * OTHER_INDEX_BYTES_PER_ROW
console.log(`the eleven read indexes on today's rows (INFERRED row counts): about ${fmt(mb(idx))} MB once, then about 0.5 KB per job as the source tables grow`)

// ---- 2. native events ---------------------------------------------------------------------------------------------------------------
type Scenario = { name: string; offices: number; diagPerDay: number; otherPerDay: number; externalPerDay: number }
const scenarios: Scenario[] = [
  { name: 'low: one office, a little tool use', offices: 1, diagPerDay: 50, otherPerDay: 5, externalPerDay: 0 },
  { name: 'expected: one canary office', offices: 1, diagPerDay: 300, otherPerDay: 10, externalPerDay: 100 },
  { name: 'at the default cap (500 diagnostic a day), one office', offices: 1, diagPerDay: 500, otherPerDay: 10, externalPerDay: 100 },
  { name: 'heavy WITHOUT the cap: 2 000 diagnostic a day, one office', offices: 1, diagPerDay: 2000, otherPerDay: 20, externalPerDay: 500 },
  { name: 'expected, five offices', offices: 5, diagPerDay: 300, otherPerDay: 10, externalPerDay: 100 },
  { name: 'at the cap, twenty-five offices', offices: 25, diagPerDay: 500, otherPerDay: 10, externalPerDay: 100 },
  { name: 'external workers at their daily cap (4 000), one office, cap on', offices: 1, diagPerDay: 500, otherPerDay: 10, externalPerDay: 4000 },
]
console.log(`\nnative events (${MEASURED.eventBytesWithLinks} B each with indexes, MEASURED 750 B without a project or job)\n`)
console.log(`${'scenario'.padEnd(64)}${'events/day'.padStart(11)}${'MB/day'.padStart(9)}${'MB/year'.padStart(9)}${`days to use ${headroom} MB`.padStart(22)}`)
for (const s of scenarios) {
  const perDay = s.offices * (s.diagPerDay + s.otherPerDay + s.externalPerDay)
  const mbDay = mb(perDay * MEASURED.eventBytesWithLinks)
  console.log(`${s.name.padEnd(64)}${String(perDay).padStart(11)}${fmt(mbDay).padStart(9)}${fmt(mbDay * 365).padStart(9)}${(headroom / mbDay).toFixed(0).padStart(22)}`)
}
console.log(`\nVacuum overhead: the table is append-only (no updates, no deletes), so there is no dead-tuple bloat to reclaim and autovacuum only freezes and sets visibility bits.`)
console.log(`Not included: WAL (transient), backups (a nightly copy is a tenth or so of the database and grows with it), and the 1 GB file-storage allowance, which is a separate limit.`)

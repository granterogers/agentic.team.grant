# Supabase Logs Query: the 5 October spike, who could have read, and the guard (6 October 2026)

**Status.** Investigation from LOCAL evidence only. No log query, usage read, Management API call or production contact was made to
write this. Supabase's Usage page shows **102.28 GB Logs Query against the Free 100 GB allowance, about 85 GB of it on 5 October**,
the day of the forensic work.

**What this document does and does not establish.** The repository's own ledger shows that scripts in this repository made about a
hundred and ten log queries that day, most of them over whole-day windows. That makes them a *plausible* reader. It does **not**
show that they account for 85 GB, because the number of bytes each query scanned was never recorded. No claim is made here that
Claude, an MCP server or any other particular caller caused the spike.

Labels used throughout: **MEASURED** (a number a system recorded about this fact), **DERIVED** (computed from measured numbers),
**INFERRED** (a reasonable reading that nothing recorded), **UNKNOWN**.

## 1. What is metered, and what is not

From Supabase's own documentation (read 6 October, public pages only):

| Fact | Label |
|---|---|
| Logs Query is "the total GB of log data scanned" by queries, across the Studio UI, the Management API, the CLI and any other interface. | MEASURED (vendor statement) |
| Over the allowance, queries are rate limited and retention is shortened. | MEASURED (vendor statement) |
| Logs Ingest (what is written) is a separate meter. Drains are metered separately and do not reduce ingest. | MEASURED (vendor statement) |
| Log Drains are available on **Pro, Team and Enterprise only**, not Free. | MEASURED (vendor statement) |

So the unit is **bytes scanned**, not queries and not rows returned. A query with no source filter over 24 hours scans every stream
for 24 hours and may return nine rows. The repository's tooling limited the *rate* (one query per 65 seconds) and nothing about
*volume*.

## 2. Mechanisms in the repository that can read the provider's logs

Traced by reading every script and module that builds a Management API URL (`analytics/endpoints/...`).

| Mechanism | Endpoint | Metered as Logs Query | Default before 6 Oct | Reached on 5 Oct |
|---|---|---|---|---|
| `scripts/forensics/logs-capture.ts` (`npm run forensics:logs`) | `analytics/endpoints/logs` | yes | **24-hour window**, no source filter required, up to 30+ queries per `--set=all` | **yes**: 106 recorded queries |
| `scripts/forensics/host-capture.ts --logs` | `analytics/endpoints/logs` | yes | 24-hour window, 8 fixed queries | yes, on 4 Oct 23:02 to 23:06 UTC (4 recorded) |
| `scripts/forensics/usage-capture.ts` (`npm run forensics:usage`) | `analytics/endpoints/usage.*` | **UNKNOWN** (nothing shows these consume the Logs Query meter: they return a few dozen aggregated points; treated as a separate class) | intervals `1day,3day,7day` plus a single count | yes: 4 recorded reads |
| `scripts/incident-snapshot.ts` | `analytics/endpoints/logs` | yes | one 30-minute query on every run, no opt-in | not known to have run |
| `scripts/forensics/metrics.ts`, `customer-metrics.ts`, `host-capture.ts --control-plane` | `analytics/endpoints/metrics` (Prometheus) | **no** (a different service) | n/a | yes, not a log read |
| The Supabase MCP server, the Supabase CLI (`supabase logs`), Studio's Log Explorer, Database Health and Reports pages | various | yes | not in this repository | **UNKNOWN**: no MCP configuration for Supabase was found in this checkout, and the other two are invisible from here |

The retired `logs.all` endpoint is never called. `hq-api`, the worker and the page do not read provider logs.

## 3. What 5 October looked like, from the tooling's own evidence

Source: `docs/ops/evidence/2026-10-05/capture-2026-10-05.jsonl` and `capture-2026-10-04.jsonl`, which the tool wrote as it ran. All
**MEASURED** unless marked.

| | Count | Server-side time (median, max) |
|---|---|---|
| Log queries recorded on 5 Oct, 06:16 to 10:50 UTC | **106** | |
| of which default 24-hour windows | 41 (6 of them whole-day `probe_sources` / `probe_attributes` scans) | 2.6 s, 9.3 s |
| of which explicit whole-day windows (`--day`) | 21 | **8.0 s**, 9.6 s |
| of which short tagged windows (`--tag`, `--start/--end`) | 44 | **2.0 s**, 6.4 s |
| Log queries recorded on 4 Oct, 23:02 to 23:06 UTC | 4 | |
| `usage.*` reads on 5 Oct | 4 | |
| Status of every one of the 110 queries | 200 (none throttled, none refused) | 396 s in total |

- **Whole-day windows: about 62** (41 default plus 21 explicit), **short windows: 44**. DERIVED.
- Whole-day queries took about four times as long server-side as short windows (8.0 s against 2.0 s median). That is the direction
  more scanned data would give. INFERRED: duration is not bytes, and fixed per-query overhead is a large part of two seconds.
- The ledger recorded **calls and timing, never scanned bytes**. The response of this endpoint carries `total_bytes_processed` when
  the service reports it and the tool did not read it. Bytes scanned for 5 October: **UNKNOWN**.
- The queries ran from repository scripts, one per 65 seconds, spread over four and a half hours. A rate limit does not bound
  volume, which is why nothing stopped them.

## 4. Does it plausibly explain 85 GB?

About 62 whole-day scans plus 44 short ones. If the 106 queries account for the whole 85 GB, the average is **about 0.8 GB scanned
per query**, or about **1.3 GB per whole-day scan** if the short windows are ignored. DERIVED arithmetic.

Whether a whole-day scan of this project's log tables is of that order depends on its daily log volume, which this investigation
does not have and which a query is the only way to learn. The honest range is: **plausible, not demonstrated**. Two things argue for
plausible: the tool's heaviest queries were the unfiltered `probe_*` scans and the queries over `postgres_logs` and `edge_logs`,
which are the largest streams on a busy project, and the timing pattern above. One thing argues against treating it as settled: the
Studio UI and any other reader are not in this ledger and the usage page does not name the caller.

### Classification

| Claim | Label |
|---|---|
| Repository scripts made about 110 log queries on 4 and 5 October, mostly at whole-day windows. | **MEASURED** (the tool's own record) |
| That volume is a plausible reader for the 5 October spike. | **DERIVED** (count, window and timing agree with the date and hour) |
| Those queries account for about 85 GB. | **INFERRED**. Bytes scanned were never recorded. |
| Claude, an MCP server, a CLI or Codex session was the caller. | **NOT ESTABLISHED.** The repository's scripts are the caller by construction; which agent session ran them is not in this record, and the session that made the 106 queries is not this one (this session's transcript contains no log-query command). |
| The Studio UI or another account contributed. | **UNKNOWN** |
| Whole-day scans are the dominant cost within the day. | **INFERRED** from the timing, not measured |

## 5. Evidence searched without making a query

- This session's transcript: no `get_logs`, no Management API log call, no `forensics:logs` run. The one network read in this
  session on the subject was public documentation pages.
- The repository's capture files and the day's ledger (above).
- Package scripts, `.mcp.json` and settings files in the checkout: no Supabase MCP configuration; `forensics:logs`, `forensics:usage`,
  `forensics:capture` and `incident:snapshot` are the npm entry points.
- Git history: the forensic commits fall on 4 to 5 October (for example `e1e1057e` 07:06, `9823aee4` 07:47, `1c2e0293` 08:16,
  `47d06d6d` 09:02, `ca8845b7` 09:52 UTC on 5 Oct), which is inside the 06:16 to 10:50 window of the recorded queries.

What would settle the caller question **without any new log query**, for Grant to look at in the dashboard (these are views, not
queries against the log service): the Usage page's daily Logs Query chart for 4 to 6 October (does the spike's shape match
06:16 to 10:50 UTC on 5 October?), and whether Studio's Log Explorer or Reports pages were open in a browser over that period.

## 6. The guard (implemented in this change)

`src/safety/log-query-budget.ts` (pure rules), `scripts/forensics/log-guard.ts` (the ledger file and the wrapper),
`tests/forensics/log-query-budget.test.ts`.

**Every route is behind it.** `mgmt()` in `scripts/forensics/common.ts` applies the guard to any request for `analytics/endpoints/logs`
or `usage.*`, so `logs-capture.ts` and `usage-capture.ts` and any script written later that uses `mgmt` are covered without knowing
the guard exists. `host-capture.ts` and `incident-snapshot.ts` send with their own `fetch` and call `withLogGuard` explicitly. A test
reads the source of every file in `scripts/`, `src/` and `supabase/` for the endpoint string and fails if a file reaches it that is
not on the guarded list or does not call the guard.

### What is the vendor's, and what is OUR policy

| | Source |
|---|---|
| Logs Query is metered as GB of log data scanned, across Studio, the Management API, the CLI and any other interface; over 100 GB (Free) queries are rate limited and retention is shortened; Logs Ingest is a separate meter; Log Drains are Pro/Team/Enterprise only | **Supabase documentation** (read 6 Oct) |
| A logs window of at most 24 hours; about one query a minute | **Observed** in this repository's own forensic notes; not verified against the current vendor docs |
| Everything numeric in the table below (60 minutes, 6 queries, 180 window-minutes, 6 usage reads, 65 s, 1 GB, the ceilings) | **OUR conservative policy.** None of it is a Supabase limit. It is chosen so the worst case this tooling can spend in a day is small beside 100 GB whatever the stream's volume, and it is the part to argue about |

### Is a bytes-scanned value available? UNVERIFIED, so the 1 GB cap is not claimed to be enforceable

No saved response in the repository carries `total_bytes_processed`: the 106 + 4 logged log queries record status, time and row
count only, and the four usage responses saved on 5 October carry only `result` (pinned by a test, `no saved usage response carries a
bytes field either`). The logs endpoint may or may not report it; this investigation does not know. So:

* the cap is kept because it costs nothing when the field is absent and bounds the spend the day it appears;
* **while no response has reported bytes, every approval the guard prints says so** (`bytes scanned is UNKNOWN ... the bytes cap cannot
  fire`), so nobody reads it as a bound;
* the window-and-count policy is the only bound in force, and the first narrow query (once authorised) settles whether the field exists.

### The rules

| Rule | Value (policy unless stated) | Why |
|---|---|---|
| A stated reason | `LOG_QUERY_REASON`, 20+ characters, recorded | Forces "does existing evidence already answer this" to be asked |
| A source | SQL must filter on `source` (one stream or `source in (...)`) | An unfiltered query scans every stream |
| Emergency override | `LOG_QUERY_EMERGENCY_REASON`, 40+ characters: lifts the source rule and the allowances to their ceilings; does **not** lift the 360 minute window ceiling, the spacing, the cache rule or the breaker; printed on stderr; the ledger row carries `override: 'emergency'` | A legitimate multi-source incident analysis, audited, countable later |
| A short window | **60 minutes**; with `LOG_QUERY_RAISE_REASON` (or the emergency reason) up to a hard ceiling of 360; a whole day cannot be asked for without editing the file | The default was 24 hours |
| Daily allowance, rolling 24 h | 6 log queries and 180 window-minutes; raised ceilings 20 and 720 | Intent rows count, so a run that crashes still spent |
| Bytes cap | 1 GB (ceiling 5 GB), **from reported bytes only** (see above) | The only direct measure of what the meter charges, if it is ever reported |
| Cache first | A query already answered for a window that covers this one is refused and the saved file is named | Reuse captured evidence |
| Spacing | 65 seconds across processes | Enforced from the ledger |
| Breaker | 402 stops all analytics queries for 24 hours; 429 for 15 minutes; nothing is retried | Asking again while refused is the defect |

**Usage reads are a separate class.** Nothing shows `usage.*` consumes the Logs Query meter, so they have their own count (6 per 24
hours, policy), take every interval the endpoint offers, need no source or window rule, and neither spend nor are spent by the log
allowance (tested both ways). They still need a reason, are spaced, and a 402 or 429 from either kind stops both, because that is the
analytics service refusing. If a later reading shows they do count, move them under the log rules in one line.

The environment can only **lower** a limit; raising needs a stated reason and stops at a ceiling. Sabotage controls run, each with
printed proof the sabotage landed: removing the guard from `mgmt` turns two wiring tests red; making the source rule unconditional or
counting usage reads as log queries each turns the matching tests red; restored, all 40 pass.

### The evidence is preserved

The 110 recorded queries stay in `docs/ops/evidence/2026-10-05/` untouched, and a test pins their number and shape (106 on 5 Oct, 4 on
4 Oct, all 200, none carrying bytes), so a later edit cannot quietly change what the investigation rests on. No query was issued.

Defaults changed with it: `logs-capture.ts` and `host-capture.ts --logs` default to **one hour** (they were 24);
`usage-capture.ts` defaults to `1day`, asks for the single count only with `--with-count` and sleeps 65 s between reads;
`incident-snapshot.ts` no longer asks the log service unless given `--logs`.

**What the guard cannot do.** The ledger is local to a checkout. It cannot see the Studio UI, another machine, another account or
a Codex session on another host, and it is not the vendor's meter. It is a guard on this repository's tooling and a record the next
investigation can read.

## 7. Recommendations

1. **Do not run any log query to answer this.** The next useful number is the bytes the service reports for ONE narrow, filtered
   ten-minute query, which the guard now records. That also calibrates every earlier estimate. It needs Grant's go-ahead and is not
   needed for the stabilisation work.
2. **Log Drains: not available on the Free plan** (Pro, Team and Enterprise only), so the vendor's advice to prefer a drain over
   repeatedly querying for new logs cannot be taken here without a plan change, which is a separate decision and is out of scope.
   If continuous machine consumption of logs is ever genuinely required, that is the point at which a plan change and a drain are
   worth costing. Nothing currently needs it: the stabilisation release reads logs only to compare a request rate before and after
   one step, and that is a ten-minute window.
3. **Prefer sources that are not Logs Query:** the Prometheus scrape (`metrics`), `pg_stat_*` counters, the `pg_cron` heartbeat table
   and the application's own tables. None of them is scanned log data.
4. **Do not reduce production logging yet.** Logs Ingest and Logs Query are separate meters; lowering ingest does not lower what a
   query scans in the way a narrower query does, and the evidence for what to cut is not in hand.
5. **The stabilisation runbook's baseline** (`forensics:logs --set=m1_edge`) is now a single, filtered, ten-minute query before and
   one after each step, under this guard, and needs Grant's fresh authorisation before the first is sent. If he would rather send no
   log query at all, the classifier already treats a missing edge reading as AMBIGUOUS, never as a pass.

## 8. Process notes

- One repository file was restored from a backup with `cp` after the sabotage control, against the File editing rule; the content was
  checked by `grep -c` and the test run before and after. Everything else went through Edit or Write; formatting was done by printing
  biome's output and transcribing it.
- A `git checkout` of another branch was attempted with uncommitted work present and was refused by git ("Aborting"), changing nothing.
- `npx biome ci .` over the whole repository fails on files this change does not touch (for example `scripts/audit/credentials.ts`,
  `scripts/leak-witness.ts`); the files in this change are clean.

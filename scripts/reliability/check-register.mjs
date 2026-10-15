#!/usr/bin/env node
// Chief of Staff Reliability — source-completeness and reconciliation checker.
// Canonical register:  docs/reliability/chief-of-staff-requirements.md
// Mirror totals:       docs/reliability/chief-of-staff-progress.md
// Sources:             docs/reliability/chief-of-staff-master-spec-consolidated.md   (authoritative)
//                      docs/reliability/chief-of-staff-incident.md                   (incident evidence)
//                      docs/reliability/chief-of-staff-master-spec.md                (historical)
//
// Run:           npm run check:reliability
// Self-test:     npm run check:reliability -- --self-test   (proves the checker can fail)
// No dependencies. Exit 0 = source-complete and reconciled. Exit 1 = any finding.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DIR = resolve(ROOT, 'docs/reliability');
const FILES = {
  register: resolve(DIR, 'chief-of-staff-requirements.md'),
  progress: resolve(DIR, 'chief-of-staff-progress.md'),
  consolidated: resolve(DIR, 'chief-of-staff-master-spec-consolidated.md'),
  incident: resolve(DIR, 'chief-of-staff-incident.md'),
  historical: resolve(DIR, 'chief-of-staff-master-spec.md'),
};

const STATUSES = { '🟢 GREEN': 'GREEN', '🟡 AMBER': 'AMBER', '🔴 RED': 'RED', '⚪ GREY': 'GREY' };
const PREFIX_COUNTS = { ECS: 39, COS: 146, REG: 45 };
const COLUMNS = 10;
const OWNER_COL = 4;
const STATUS_COL = 5;
const EVIDENCE_COL = 6;
const TEST_COL = 8;
const BLOCKER_COL = 9;

const EXPECTED_INVENTORY = 76; // consolidated §7 "Cover at minimum" list
const EXPECTED_REGRESSION = 45; // consolidated §25 list
const EXPECTED_HISTORICAL_TOPICS = 58; // historical §3 topics 1-58
const EXPECTED_HISTORICAL_EXAMPLES = 10; // historical §3 named examples
const EXPECTED_TRANSCRIPT_ENTRIES = 8; // incident evidence entries

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function parseRegister(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\| ((?:ECS|COS|REG)-\d{3}) \|/);
    if (!m) continue;
    const cells = line.slice(1, line.lastIndexOf('|')).split('|').map((c) => c.trim());
    rows.push({ id: m[1], cells });
  }
  return rows;
}

export function parseTraceability(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^\| (CONS-(?:7|25)\.\d{2}) \| [^|]+ \| ((?:ECS|COS|REG)-\d{3}) \|$/);
    if (m) map.set(m[1], (map.get(m[1]) ?? []).concat(m[2]));
  }
  return map;
}

// Items in consolidated §7 "Cover at minimum:" (numbered 1..n) up to "This is a minimum domain inventory".
export function parseConsolidatedInventory(text) {
  const start = text.indexOf('Cover at minimum:');
  const end = text.indexOf('This is a minimum domain inventory');
  if (start < 0 || end < 0 || end <= start) return null;
  const items = [];
  for (const line of text.slice(start, end).split('\n')) {
    const m = line.match(/^(\d+)\. (.+)$/);
    if (m) items.push({ n: Number(m[1]), title: m[2].trim() });
  }
  return items;
}

// Items in consolidated §25 "must cover at least:" list up to "Extend this list".
export function parseRegressionList(text) {
  const start = text.indexOf('The test suite must cover at least:');
  const end = text.indexOf('Extend this list based on discovered defects');
  if (start < 0 || end < 0 || end <= start) return null;
  const items = [];
  for (const line of text.slice(start, end).split('\n')) {
    const m = line.match(/^(\d+)\. (.+)$/);
    if (m) items.push({ n: Number(m[1]), title: m[2].trim() });
  }
  return items;
}

function epicUrl(text) {
  const m = text.match(/^\*\*Epic:\*\* (\S+)/m);
  return m ? m[1] : null;
}

function headerHash(text, label) {
  const m = text.match(new RegExp(`^${label} SHA-256: ([0-9a-f]{64})$`, 'm'));
  return m ? m[1] : null;
}

export function parseProgressTotals(text) {
  const m = text.match(/🟢 (\d+) \| 🟡 (\d+) \| 🔴 (\d+) \| ⚪ (\d+) — Total (\d+)\/(\d+) tracked/);
  if (!m) return null;
  return {
    GREEN: Number(m[1]),
    AMBER: Number(m[2]),
    RED: Number(m[3]),
    GREY: Number(m[4]),
    total: Number(m[5]),
    tracked: Number(m[6]),
  };
}

// Returns findings for the given texts. An empty list means source-complete and reconciled.
// `files` maps each logical name to its text; hashes are compared against the same text.
export function validate(files) {
  const { register: regText, progress: progText, consolidated, incident, historical } = files;
  const findings = [];
  const rows = parseRegister(regText);

  // 1. Permanent IDs: unique, contiguous, none missing or orphaned.
  const seen = new Map();
  for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) findings.push(`${id} appears ${n} times (duplicate)`);
  for (const [prefix, count] of Object.entries(PREFIX_COUNTS)) {
    for (let i = 1; i <= count; i++) {
      const id = `${prefix}-${String(i).padStart(3, '0')}`;
      if (!seen.has(id)) findings.push(`${id} is missing from the register (silent deletion)`);
    }
  }
  for (const id of seen.keys()) {
    const [prefix, num] = id.split('-');
    const max = PREFIX_COUNTS[prefix];
    if (!max || Number(num) < 1 || Number(num) > max) findings.push(`${id} is outside the registered range (orphan)`);
  }

  // 2. Each row: shape, owner, one valid status, auditable basis.
  const tally = { GREEN: 0, AMBER: 0, RED: 0, GREY: 0 };
  for (const r of rows) {
    if (r.cells.length !== COLUMNS) {
      findings.push(`${r.id} has ${r.cells.length} columns, expected ${COLUMNS}`);
      continue;
    }
    const status = STATUSES[r.cells[STATUS_COL]];
    if (!status) {
      findings.push(`${r.id} has invalid status "${r.cells[STATUS_COL]}"`);
      continue;
    }
    tally[status]++;
    if (!r.cells[OWNER_COL] || r.cells[OWNER_COL] === '—') findings.push(`${r.id} has no owner`);
    if (!r.cells[0 + 2] || r.cells[2] === '—') findings.push(`${r.id} has no source reference`);
    if (status === 'GREEN') {
      if (!r.cells[EVIDENCE_COL] || r.cells[EVIDENCE_COL] === '—') findings.push(`${r.id} is GREEN without evidence`);
      if (!r.cells[TEST_COL] || r.cells[TEST_COL] === '—') findings.push(`${r.id} is GREEN without a test reference`);
    }
    if (status === 'RED' && (!r.cells[BLOCKER_COL] || r.cells[BLOCKER_COL] === '—')) {
      findings.push(`${r.id} is RED without a documented blocker`);
    }
  }

  // 3. Epic linked (ECS-008).
  const epic = epicUrl(regText);
  if (!epic || !/^https:\/\/github\.com\//.test(epic)) findings.push('register has no epic URL');

  // 4. Source preservation: header hashes must match the files on disk.
  const pairs = [
    ['Consolidated specification', consolidated],
    ['Incident transcript', incident],
    ['Historical execution-control specification', historical],
  ];
  for (const [label, text] of pairs) {
    if (text === null) {
      findings.push(`${label} file is missing`);
      continue;
    }
    const recorded = headerHash(regText, label);
    if (!recorded) findings.push(`register records no SHA-256 for ${label}`);
    else if (recorded !== sha256(text)) findings.push(`${label} changed since it was recorded (hash mismatch)`);
  }

  // 5. Source-requirement completeness (the check the epic demanded, not merely status presence).
  if (consolidated !== null) {
    const inventory = parseConsolidatedInventory(consolidated);
    if (!inventory || inventory.length !== EXPECTED_INVENTORY) {
      findings.push(`consolidated §7 inventory: found ${inventory?.length ?? 0}, expected ${EXPECTED_INVENTORY}`);
    }
    const regression = parseRegressionList(consolidated);
    if (!regression || regression.length !== EXPECTED_REGRESSION) {
      findings.push(`consolidated §25 regression list: found ${regression?.length ?? 0}, expected ${EXPECTED_REGRESSION}`);
    }
    const trace = parseTraceability(regText);
    for (let n = 1; n <= EXPECTED_INVENTORY; n++) {
      const key = `CONS-7.${String(n).padStart(2, '0')}`;
      const ids = trace.get(key);
      if (!ids) findings.push(`${key} is not mapped to a register ID (missing source requirement)`);
      else if (ids.length !== 1) findings.push(`${key} is mapped ${ids.length} times, expected once`);
      else if (!seen.has(ids[0])) findings.push(`${key} maps to ${ids[0]}, which is not in the register`);
    }
    for (let n = 1; n <= EXPECTED_REGRESSION; n++) {
      const key = `CONS-25.${String(n).padStart(2, '0')}`;
      const ids = trace.get(key);
      if (!ids) findings.push(`${key} is not mapped to a register ID (missing regression test)`);
      else if (ids.length !== 1) findings.push(`${key} is mapped ${ids.length} times, expected once`);
      else if (!seen.has(ids[0])) findings.push(`${key} maps to ${ids[0]}, which is not in the register`);
    }
  }

  // 6. Historical topics and examples remain represented in the register.
  const sources = rows.map((r) => r.cells[2] ?? '');
  for (let n = 1; n <= EXPECTED_HISTORICAL_TOPICS; n++) {
    const hits = sources.filter((s) => new RegExp(`Historical §3 topic ${n}(?!\\d)`).test(s)).length;
    if (hits !== 1) findings.push(`historical §3 topic ${n} is represented ${hits} times, expected once`);
  }
  const examples = sources.filter((s) => /Historical §3 example/.test(s)).length;
  if (examples !== EXPECTED_HISTORICAL_EXAMPLES) {
    findings.push(`historical §3 examples represented ${examples}, expected ${EXPECTED_HISTORICAL_EXAMPLES}`);
  }

  // 7. Incident evidence intact: every transcript entry is present.
  if (incident !== null) {
    const entries = (incident.match(/^## 15 October 2026/gm) ?? []).length;
    if (entries !== EXPECTED_TRANSCRIPT_ENTRIES) {
      findings.push(`incident transcript has ${entries} entries, expected ${EXPECTED_TRANSCRIPT_ENTRIES}`);
    }
  }

  // 8. Progress totals reconcile exactly with the register.
  const totals = parseProgressTotals(progText);
  if (!totals) {
    findings.push('progress file has no reconciliation line');
  } else {
    for (const s of ['GREEN', 'AMBER', 'RED', 'GREY']) {
      if (totals[s] !== tally[s]) findings.push(`progress says ${s} ${totals[s]}, register has ${tally[s]}`);
    }
    const sum = tally.GREEN + tally.AMBER + tally.RED + tally.GREY;
    if (totals.total !== sum || totals.tracked !== rows.length) {
      findings.push(`progress says ${totals.total}/${totals.tracked}, register has ${sum} statuses across ${rows.length} rows`);
    }
  }
  return findings;
}

function loadFiles() {
  const out = {};
  for (const [key, path] of Object.entries(FILES)) {
    try {
      out[key] = readFileSync(path, 'utf8');
    } catch {
      out[key] = null;
    }
  }
  return out;
}

function selfTest(files) {
  const failures = [];
  const { register, progress } = files;
  const expectFail = (label, mutated) => {
    // A sabotage that changes nothing proves nothing: refuse to count it as a detection.
    const applied = Object.entries(mutated).some(([k, v]) => v !== files[k]);
    if (!applied) {
      failures.push(`self-test: sabotage "${label}" did not change its file (the search text is stale)`);
      return;
    }
    if (validate({ ...files, ...mutated }).length === 0) failures.push(`self-test: sabotage "${label}" was NOT detected`);
  };
  const expectPass = (label, mutated) => {
    const f = validate({ ...files, ...mutated });
    if (f.length !== 0) failures.push(`self-test: control "${label}" was wrongly rejected: ${f[0]}`);
  };

  // Control: the unmodified records must pass.
  expectPass('unmodified', {});

  expectFail('duplicate ID', { register: register.replace('| COS-002 |', '| COS-001 |') });
  expectFail('deleted ID', { register: register.replace(/^\| COS-030 \|.*\n/m, '') });
  expectFail('invalid status', { register: register.replace('🟢 GREEN | Validator reconciles progress', 'GREEN? | Validator reconciles progress') });
  expectFail('GREEN without evidence', {
    register: register.replace(/(\| ECS-011 \| [^|]*\| [^|]*\| [^|]*\| [^|]*\| 🟢 GREEN \| )[^|]*\|/, '$1 — |'),
  });
  expectFail('total drift', { progress: progress.replace('Total 230/230', 'Total 229/230').replace('⚪ 160', '⚪ 159') });
  expectFail('missing source requirement (inventory item unmapped)', {
    register: register.replace(/^\| CONS-7\.40 \|.*\n/m, ''),
  });
  expectFail('missing regression item (CONS-25 unmapped)', {
    register: register.replace(/^\| CONS-25\.45 \|.*\n/m, ''),
  });
  expectFail('source edited after recording (hash mismatch)', {
    consolidated: files.consolidated.replace('Canary Coworking Project incident', 'Canary Coworking incident'),
  });
  expectFail('transcript entry removed', {
    incident: files.incident.replace('## 15 October 2026 — 15:45', '## removed'),
  });
  expectFail('placeholder epic', { register: register.replace(/^\*\*Epic:\*\* \S+/m, '**Epic:** EPIC_URL') });
  expectFail('historical topic dropped', {
    register: register.replace(/^\| COS-040 \|.*\n/m, ''),
  });
  return failures;
}

function main() {
  const files = loadFiles();
  if (files.register === null || files.progress === null) {
    console.error('FAIL register or progress file is missing');
    process.exit(1);
  }
  if (process.argv.includes('--self-test')) {
    const failures = selfTest(files);
    if (failures.length) {
      for (const f of failures) console.error(f);
      process.exit(1);
    }
    console.log('self-test: all sabotages detected, control passed');
    return;
  }
  const findings = validate(files);
  const rows = parseRegister(files.register);
  if (findings.length) {
    for (const f of findings) console.error(`FAIL ${f}`);
    console.error(`reliability register: ${findings.length} finding(s) across ${rows.length} rows`);
    process.exit(1);
  }
  console.log(`reliability register: ${rows.length} rows, sources complete and reconciled with progress`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

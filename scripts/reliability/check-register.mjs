#!/usr/bin/env node
// Chief of Staff Reliability — completeness and reconciliation checker.
// Canonical register: docs/reliability/chief-of-staff-requirements.md
// Mirror totals:      docs/reliability/chief-of-staff-progress.md
// Run:  npm run check:reliability           (live files)
//       npm run check:reliability -- --self-test  (proves the checker can fail)
// No dependencies. Exit 0 = reconciled, 1 = any finding.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const REGISTER = resolve(ROOT, 'docs/reliability/chief-of-staff-requirements.md');
const PROGRESS = resolve(ROOT, 'docs/reliability/chief-of-staff-progress.md');

const STATUSES = { '🟢 GREEN': 'GREEN', '🟡 AMBER': 'AMBER', '🔴 RED': 'RED', '⚪ GREY': 'GREY' };
const EXPECTED = [
  { prefix: 'ECS', count: 20 },
  { prefix: 'COS', count: 68 },
];
const COLUMNS = 10;
const STATUS_COL = 5;
const OWNER_COL = 4;
const EVIDENCE_COL = 6;
const TEST_COL = 8;
const BLOCKER_COL = 9;

export function parseRegister(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\| ((?:ECS|COS)-\d{3}) \|/);
    if (!m) continue;
    const cells = line.slice(1, line.lastIndexOf('|')).split('|').map((c) => c.trim());
    rows.push({ id: m[1], cells });
  }
  return rows;
}

function epicUrl(text) {
  const m = text.match(/^\*\*Epic:\*\* (\S+)/m);
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

// Returns a list of findings. An empty list means the records reconcile.
export function validate(registerText, progressText) {
  const findings = [];
  const rows = parseRegister(registerText);

  // 1. Expected identifiers exist exactly once, with none orphaned.
  const seen = new Map();
  for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) findings.push(`${id} appears ${n} times (duplicate)`);
  for (const { prefix, count } of EXPECTED) {
    for (let i = 1; i <= count; i++) {
      const id = `${prefix}-${String(i).padStart(3, '0')}`;
      if (!seen.has(id)) findings.push(`${id} is missing from the register (silent deletion)`);
    }
  }
  for (const id of seen.keys()) {
    const [prefix, num] = id.split('-');
    const spec = EXPECTED.find((e) => e.prefix === prefix);
    if (!spec || Number(num) < 1 || Number(num) > spec.count) findings.push(`${id} is not in the expected range (orphan)`);
  }

  // 2. Each row: column shape, owner, one valid status, auditable basis.
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
    const evidence = r.cells[EVIDENCE_COL];
    const test = r.cells[TEST_COL];
    if (status === 'GREEN') {
      if (!evidence || evidence === '—') findings.push(`${r.id} is GREEN without evidence`);
      if (!test || test === '—') findings.push(`${r.id} is GREEN without a test reference`);
    }
    if (status === 'RED' && (!r.cells[BLOCKER_COL] || r.cells[BLOCKER_COL] === '—')) {
      findings.push(`${r.id} is RED without a documented blocker`);
    }
  }

  // 3. Epic is linked (ECS-008). A placeholder fails until the epic exists.
  const epic = epicUrl(registerText);
  if (!epic || !/^https:\/\/github\.com\//.test(epic)) findings.push('register has no epic URL');

  // 4. Progress totals reconcile exactly with the register.
  const totals = parseProgressTotals(progressText);
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

function selfTest(registerText, progressText) {
  const failures = [];
  const expectFail = (label, reg, prog = progressText) => {
    const f = validate(reg, prog);
    if (f.length === 0) failures.push(`self-test: sabotage "${label}" was NOT detected`);
  };
  const expectPass = (label, reg, prog = progressText) => {
    const f = validate(reg, prog);
    if (f.length !== 0) failures.push(`self-test: control "${label}" was wrongly rejected: ${f[0]}`);
  };

  // Control: unmodified text must pass when the epic is present.
  const withEpic = registerText.replace(/^\*\*Epic:\*\* \S+/m, '**Epic:** https://github.com/example/x/issues/1');
  expectPass('unmodified', withEpic);

  expectFail('duplicate ID', withEpic.replace('| COS-002 |', '| COS-001 |'));
  expectFail('deleted ID', withEpic.replace(/^\| COS-030 \|.*\n/m, ''));
  expectFail('bad status', withEpic.replace('🟢 GREEN | ', 'GREEN? | ').replace(/\| ECS-010 \|/, '| ECS-010 |'));
  expectFail('GREEN without evidence', withEpic.replace(/(\| ECS-011 \| [^|]*\| [^|]*\| [^|]*\| [^|]*\| 🟢 GREEN \| )[^|]*\|/, '$1 — |'));
  expectFail('total drift', progressText.replace('Total 88/88', 'Total 87/88'));
  expectFail('placeholder epic', registerText.replace(/^\*\*Epic:\*\* \S+/m, '**Epic:** EPIC_URL'));
  return failures;
}

function main() {
  const registerText = readFileSync(REGISTER, 'utf8');
  const progressText = readFileSync(PROGRESS, 'utf8');
  if (process.argv.includes('--self-test')) {
    const failures = selfTest(registerText, progressText);
    if (failures.length) {
      for (const f of failures) console.error(f);
      process.exit(1);
    }
    console.log('self-test: all sabotages detected, control passed');
    return;
  }
  const findings = validate(registerText, progressText);
  const rows = parseRegister(registerText);
  if (findings.length) {
    for (const f of findings) console.error(`FAIL ${f}`);
    console.error(`reliability register: ${findings.length} finding(s) across ${rows.length} rows`);
    process.exit(1);
  }
  console.log(`reliability register: ${rows.length} rows reconciled with progress file`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

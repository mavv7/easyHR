import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestZambiaDeductions } from '../src/cloud/zambiaPayroll.ts';

test('2026 monthly PAYE matches ZRA bands and its K15,000 example', () => {
  assert.equal(suggestZambiaDeductions('2026-01', 510_000, 0)?.paye, 0);
  assert.equal(suggestZambiaDeductions('2026-01', 710_000, 0)?.paye, 40_000);
  assert.equal(suggestZambiaDeductions('2026-01', 920_000, 0)?.paye, 103_000);
  assert.deepEqual(suggestZambiaDeductions('2026-12', 1_200_000, 300_000), {
    gross: 1_500_000, paye: 317_600, napsa: 75_000, nhima: 12_000,
    deductions: 404_600, net: 1_095_400, employer: 87_000,
  });
});

test('NAPSA caps each share, NHIMA uses basic pay, and unconfigured years stay unavailable', () => {
  assert.equal(suggestZambiaDeductions('2026-04', 3_700_000, 0)?.napsa, 185_000);
  const estimate = suggestZambiaDeductions('2026-04', 3_700_000, 300_000);
  assert.equal(estimate?.napsa, 186_180);
  assert.equal(estimate?.nhima, 37_000);
  assert.equal(estimate?.employer, 223_180);
  assert.equal(suggestZambiaDeductions('2025-12', 500_000, 0), null);
  assert.equal(suggestZambiaDeductions('2027-01', 500_000, 0), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekdays, decideLeave, seed, money } from '../src/domain.ts';

test('weekday ranges exclude weekends and reject malformed dates', () => {
  assert.equal(weekdays('2026-11-20', '2026-11-23'), 2);
  assert.throws(() => weekdays('2026-02-30', '2026-03-03'));
  assert.throws(() => weekdays('2026-11-23', '2026-11-20'));
  assert.throws(() => weekdays('2026-11-21', '2026-11-22'));
});
test('approval deducts balance once and keeps source immutable', () => {
  const next = decideLeave(seed, 'l1', true);
  assert.equal(next.employees.find(e => e.id === '2')!.balance, 13);
  assert.equal(seed.employees.find(e => e.id === '2')!.balance, 16);
  assert.throws(() => decideLeave(next, 'l1', true));
});
test('decline keeps balance and insufficient balance blocks approval', () => {
  assert.equal(decideLeave(seed, 'l1', false).employees[1].balance, 16);
  const low = { ...seed, employees: seed.employees.map(e => ({ ...e, balance: 0 })) };
  assert.throws(() => decideLeave(low, 'l1', true));
});
test('salary display uses minor units', () => assert.equal(money(1500000), 'K 15,000.00'));

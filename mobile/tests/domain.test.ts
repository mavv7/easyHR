import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekdays, decideLeave, requestLeave, seed, money } from '../src/domain.ts';

test('weekday ranges exclude weekends and reject malformed dates', () => {
  assert.equal(weekdays('2026-11-20', '2026-11-23'), 2);
  assert.throws(() => weekdays('2026-02-30', '2026-03-03'));
  assert.throws(() => weekdays('2026-11-23', '2026-11-20'));
  assert.throws(() => weekdays('2026-11-21', '2026-11-22'));
  assert.throws(() => weekdays('0000-01-01', '0000-01-07'));
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

test('demo leave requests reserve pending days and release them when declined', () => {
  const request = { id: 'new', employeeId: '2', start: '2026-12-01', end: '2026-12-18', reason: 'Annual leave' };
  assert.throws(() => requestLeave(seed, request), /unreserved/);

  const declined = decideLeave(seed, 'l1', false);
  const next = requestLeave(declined, request);
  assert.equal(next.leave[0].days, 14);
  assert.equal(next.leave[0].status, 'Pending');
  assert.equal(next.employees[1].balance, 16);
});

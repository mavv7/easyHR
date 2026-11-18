import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CloudLeave } from '../src/cloud/api.ts';
import { calendarDays, calendarMonth } from '../src/cloud/leaveCalendar.ts';

test('leave calendar aligns Monday-first weeks and handles leap days and year changes', () => {
  const days = calendarDays('2028-02', []);
  assert.equal(days[0], null);
  assert.equal(days[1]?.date, '2028-02-01');
  assert.equal(days.filter(Boolean).length, 29);
  assert.equal(days.length % 7, 0);
  assert.equal(calendarMonth('2027-12', 1), '2028-01');
  assert.equal(calendarMonth('2028-01', -1), '2027-12');
});

test('leave calendar shows pending and approved requests across months on weekdays', () => {
  const range = {
    employee_id: 'employee', created_at: '2028-02-01T00:00:00Z',
    start_date: '2028-02-28', end_date: '2028-03-06', reason: 'Example', days: 6,
  };
  const statuses = ['Pending', 'Approved', 'Declined', 'Cancelled'] as const;
  const requests: CloudLeave[] = statuses.map(status => ({ ...range, id: status, status }));
  const february = calendarDays('2028-02', requests);
  const march = calendarDays('2028-03', requests);
  assert.deepEqual(february.find(day => day?.date === '2028-02-29')?.requests.map(request => request.id), ['Pending', 'Approved']);
  assert.equal(march.find(day => day?.date === '2028-03-04')?.requests.length, 0);
  assert.equal(march.find(day => day?.date === '2028-03-06')?.requests.length, 2);
  assert.equal(march.find(day => day?.date === '2028-03-07')?.requests.length, 0);
});

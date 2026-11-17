import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPages } from '../src/cloud/pagination.ts';

test('workspace pagination reads past the API row cap and accepts short pages', async () => {
  const records = Array.from({ length: 1037 }, (_, index) => ({ id: String(index).padStart(4, '0') }));
  const cursors: (string | null)[] = [];
  const result = await collectPages(async after => {
    cursors.push(after);
    return { data: records.filter(row => after === null || row.id > after).slice(0, 100), error: null };
  }, row => row.id);
  assert.deepEqual(result, records);
  assert.equal(cursors.length, 12);
  assert.equal(cursors.at(-1), '1036');
});

test('workspace pagination surfaces page failures and rejects a stuck cursor', async () => {
  const row = { id: '001' };
  const unavailable = new Error('Second page failed');
  await assert.rejects(collectPages(async after => after
    ? { data: null, error: unavailable }
    : { data: [row], error: null }, value => value.id), unavailable);
  await assert.rejects(collectPages(async () => ({ data: [row], error: null }), value => value.id), /did not advance/);
});

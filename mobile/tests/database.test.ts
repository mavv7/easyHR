import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL semantics in WASM; only Supabase's auth schema/roles are emulated.
// Hosted Auth, network transport and native session storage still require integration tests.
test('database isolation, authorization and atomic leave workflow', async t => {
  const db = new PGlite();
  const ids = { hr: '00000000-0000-4000-8000-000000000001', employee: '00000000-0000-4000-8000-000000000002', manager: '00000000-0000-4000-8000-000000000003', outsider: '00000000-0000-4000-8000-000000000004' };
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
    await db.exec(await readFile(new URL('../supabase/migrations/202611180001_hr_foundation.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202611180002_company_signup.sql', import.meta.url), 'utf8'));
    for (const [id, name, company] of [[ids.hr, 'hr', 'Mango Studio'], [ids.outsider, 'outsider', 'Other company']]) {
      await db.query('insert into auth.users values ($1, $2, null, $3)', [id, name + '@example.com', { company_name: company }]);
    }
    await assert.rejects(db.query("insert into auth.users values (gen_random_uuid(), 'uninvited@example.com', null, '{}')"), /approval required/);
    async function as(user: string) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]); await db.exec('set role authenticated'); }
    async function scalar(sql: string, args: unknown[] = []) { const r = await db.query<Record<string, string>>(sql, args); return Object.values(r.rows[0])[0]; }
    await as(ids.hr);
    await db.query('select public.hr_activate_workspace()');
    assert.equal((await db.query('select * from public.hr_organizations')).rows.length, 0);
    await assert.rejects(db.query("select easyhr_private.hr_create_organization('Bypass')"), /permission denied/);
    await db.exec('reset role; update auth.users set email_confirmed_at = now()');
    await as(ids.hr);
    await db.query('select public.hr_activate_workspace()');
    await db.query('select public.hr_activate_workspace()');
    assert.equal((await db.query('select * from public.hr_organizations')).rows.length, 1);
    const org = await scalar('select id from public.hr_organizations');
    await db.query("select public.hr_add_member($1, 'manager@example.com', 'manager')", [org]);
    await db.exec('reset role');
    await db.query("insert into auth.users values ($1, 'manager@example.com', now(), '{}')", [ids.manager]);
    await as(ids.manager);
    await db.query('select public.hr_activate_workspace()');
    await as(ids.hr);
    const employee = await scalar("select public.hr_save_employee($1, 'Employee One', 'Designer', 'Design', 'employee@example.com', 10, $2)", [org, ids.manager]);
    await db.query("select public.hr_add_member($1, 'employee@example.com', 'employee', $2)", [org, employee]);
    await db.exec('reset role');
    await db.query("insert into auth.users values ($1, 'employee@example.com', null, '{}')", [ids.employee]);
    await as(ids.employee);
    await db.query('select public.hr_activate_workspace()');
    assert.equal((await db.query('select * from public.hr_members')).rows.length, 0);
    await db.exec('reset role');
    await db.query('update auth.users set email_confirmed_at = now() where id = $1', [ids.employee]);
    await as(ids.employee);
    await db.query('select public.hr_activate_workspace()');
    await as(ids.hr);
    const ownerEmployee = await scalar("select public.hr_save_employee($1, 'HR Owner', 'HR', 'People', 'hr@example.com', 15)", [org]);
    await t.test('self-approval is blocked even before the HR employee record is linked', async () => {
      const own = await scalar("select public.hr_request_leave($1,'2027-02-01','2027-02-02','Personal')", [ownerEmployee]);
      await assert.rejects(db.query('select public.hr_decide_leave($1,true)', [own]));
    });
    await db.query("select public.hr_add_member($1, 'hr@example.com', 'hr', $2)", [org, ownerEmployee]);
    await t.test('employee sees only self and cannot write records, roles or audits directly', async () => {
      await as(ids.employee);
      assert.equal((await db.query('select * from public.hr_employees')).rows.length, 1);
      await assert.rejects(db.query('update public.hr_employees set leave_balance = 100'));
      await assert.rejects(db.query("insert into public.hr_members values($1, $2, 'hr')", [org, ids.outsider]));
      await assert.rejects(db.query("select public.hr_save_employee($1,'Changed','Role','Dept','employee@example.com',100)", [org]));
      await assert.rejects(db.query("insert into public.hr_audit_events(organization_id,actor_id,action) values($1,$2,'forged')", [org, ids.employee]));
    });
    let request: string;
    await t.test('employee requests leave; duplicates, excess and self-approval are rejected', async () => {
      await as(ids.employee);
      request = await scalar("select public.hr_request_leave($1,'2026-11-23','2026-11-25','Family time')", [employee]);
      await assert.rejects(db.query("select public.hr_request_leave($1,'2026-11-24','2026-11-26','Overlap')", [employee]));
      await assert.rejects(db.query("select public.hr_request_leave($1,'2026-12-01','2026-12-15','Excess')", [employee]));
      await assert.rejects(db.query('select public.hr_decide_leave($1,true)', [request]));
    });
    await t.test('assigned manager approves once, cannot see unrelated employees or change balances', async () => {
      await as(ids.manager);
      assert.equal((await db.query('select * from public.hr_employees')).rows.length, 1);
      await db.query('select public.hr_decide_leave($1,true)', [request!]);
      assert.equal(Number(await scalar('select leave_balance from public.hr_employees where id=$1', [employee])), 7);
      await assert.rejects(db.query('select public.hr_decide_leave($1,true)', [request!]));
      assert.equal(Number(await scalar('select leave_balance from public.hr_employees where id=$1', [employee])), 7);
      await assert.rejects(db.query("select public.hr_request_leave($1,'2027-01-04','2027-01-05','Manager request')", [employee]));
    });
    await t.test('HR cannot approve their own leave', async () => {
      await as(ids.hr);
      const ownRequest = await scalar("select public.hr_request_leave($1,'2026-11-23','2026-11-24','Personal')", [ownerEmployee]);
      await assert.rejects(db.query('select public.hr_decide_leave($1,true)', [ownRequest]));
    });
    await t.test('another company cannot read or mutate tenant data', async () => {
      await as(ids.outsider);
      await db.query('select public.hr_activate_workspace()');
      assert.notEqual(await scalar('select id from public.hr_organizations'), org);
      assert.equal((await db.query('select * from public.hr_employees')).rows.length, 0);
      assert.equal((await db.query('select * from public.hr_leave_requests')).rows.length, 0);
      await assert.rejects(db.query('select public.hr_decide_leave($1,false)', [request!]));
      await assert.rejects(db.query("select public.hr_add_member($1,'outsider@example.com','hr')", [org]));
    });
    await t.test('stale edit rejected and server audit records successful actions only', async () => {
      await as(ids.hr);
      await assert.rejects(db.query("select public.hr_save_employee($1,'Employee One','Designer','Design','employee@example.com',10,$2,$3,1)", [org, ids.manager, employee]));
      const events = await db.query<{ action: string }>('select action from public.hr_audit_events');
      assert.equal(events.rows.filter(e => e.action === 'leave.approved').length, 1);
      assert.equal(events.rows.filter(e => e.action === 'leave.requested').length, 3);
    });
    await t.test('declining releases reserved days without reducing balance', async () => {
      await as(ids.employee);
      const pending = await scalar("select public.hr_request_leave($1,'2027-03-01','2027-03-05','Five days')", [employee]);
      await assert.rejects(db.query("select public.hr_request_leave($1,'2027-03-08','2027-03-10','Exceeds remaining reservation')", [employee]));
      await as(ids.manager);
      await db.query('select public.hr_decide_leave($1,false)', [pending]);
      assert.equal(Number(await scalar('select leave_balance from public.hr_employees where id=$1', [employee])), 7);
      await as(ids.employee);
      await scalar("select public.hr_request_leave($1,'2027-03-01','2027-03-05','Replacement request')", [employee]);
    });
    await t.test('anonymous sessions cannot read tables or execute write functions', async () => {
      await db.exec('reset role; set role anon');
      await assert.rejects(db.query('select * from public.hr_employees'));
      await assert.rejects(db.query('select public.hr_activate_workspace()'));
    });
  } finally { await db.close(); }
});

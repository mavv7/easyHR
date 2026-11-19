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
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb,
        phone text, phone_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
    await db.exec(await readFile(new URL('../supabase/migrations/202611180001_hr_foundation.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202611180002_company_signup.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202611180003_manage_members.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202611180004_pending_requests.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202611180005_contracts_payroll.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202611190006_company_settings.sql', import.meta.url), 'utf8'));
    await db.query('insert into auth.users values ($1, $2, null, $3)', [ids.outsider, 'outsider@example.com', { company_name: 'Other company' }]);
    await db.exec(await readFile(new URL('../supabase/migrations/202611190007_company_signup_otp.sql', import.meta.url), 'utf8'));
    const registration = { company_name: 'Mango Studio', company_type: 'limited_company', tpin: '0123456789', registration_phone: '+260971234567' };
    await assert.rejects(db.query("insert into auth.users values (gen_random_uuid(), 'legacy@example.com', null, $1)", [
      { company_name: 'Missing details' },
    ]), /company type, 10-digit TPIN/);
    await assert.rejects(db.query("insert into auth.users values (gen_random_uuid(), 'invalid@example.com', null, $1)", [
      { ...registration, tpin: '123' },
    ]), /10-digit TPIN/);
    await db.query('insert into auth.users values ($1, $2, null, $3)', [ids.hr, 'hr@example.com', registration]);
    await assert.rejects(db.query("insert into auth.users values (gen_random_uuid(), 'uninvited@example.com', null, '{}')"), /approval required/);
    async function as(user: string) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]); await db.exec('set role authenticated'); }
    async function scalar(sql: string, args: unknown[] = []) { const r = await db.query<Record<string, string>>(sql, args); return Object.values(r.rows[0])[0]; }
    await as(ids.hr);
    await db.query('select public.hr_activate_workspace()');
    assert.equal((await db.query('select * from public.hr_organizations')).rows.length, 0);
    assert.equal(await scalar('select public.hr_pending_company_phone()'), null);
    await assert.rejects(db.query("select easyhr_private.hr_create_organization('Bypass')"), /permission denied/);
    await db.exec('reset role; update auth.users set email_confirmed_at = now()');
    await as(ids.hr);
    await db.query('select public.hr_activate_workspace()');
    assert.equal((await db.query('select * from public.hr_organizations')).rows.length, 0);
    assert.equal(await scalar('select public.hr_pending_company_phone()'), '+260971234567');
    await db.exec('reset role');
    await db.query("update auth.users set phone = '260977654321' where id = $1", [ids.hr]);
    await as(ids.hr);
    await db.query('select public.hr_activate_workspace()');
    assert.equal((await db.query('select * from public.hr_organizations')).rows.length, 0);
    await db.exec('reset role');
    await db.query('update auth.users set phone_confirmed_at = now() where id = $1', [ids.hr]);
    await as(ids.hr);
    await db.query('select public.hr_activate_workspace()');
    await db.query('select public.hr_activate_workspace()');
    assert.equal((await db.query('select * from public.hr_organizations')).rows.length, 1);
    assert.equal(await scalar('select public.hr_pending_company_phone()'), null);
    assert.equal(await scalar('select company_type from public.hr_company_settings'), 'limited_company');
    assert.equal(await scalar("select profile->>'email' from public.hr_company_settings"), 'hr@example.com');
    assert.equal(await scalar("select profile->>'phone' from public.hr_company_settings"), '+260977654321');
    assert.equal(await scalar("select profile->>'tpin' from public.hr_company_settings"), '0123456789');
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
    await t.test('cancelling pending leave frees the date range and reservation without deducting balance', async () => {
      await as(ids.employee);
      const requestLeave = "select public.hr_request_leave($1,'2027-03-08','2027-03-09','Two days')";
      const pending = await scalar(requestLeave, [employee]);
      await assert.rejects(db.query(requestLeave, [employee]), /overlaps/);
      await as(ids.manager);
      await assert.rejects(db.query('select public.hr_cancel_leave($1)', [pending]), /unavailable/);
      await as(ids.outsider);
      await assert.rejects(db.query('select public.hr_cancel_leave($1)', [pending]), /unavailable/);
      await as(ids.employee);
      await assert.rejects(db.query('select public.hr_cancel_leave($1)', [request!]), /Only pending/);
      await db.query('select public.hr_cancel_leave($1)', [pending]);
      await assert.rejects(db.query('select public.hr_cancel_leave($1)', [pending]), /Only pending/);
      assert.equal(await scalar('select status from public.hr_leave_requests where id=$1', [pending]), 'Cancelled');
      const replacement = await scalar(requestLeave, [employee]);
      await as(ids.hr);
      await db.query('select public.hr_cancel_leave($1)', [replacement]);
      await assert.rejects(db.query('select public.hr_decide_leave($1,true)', [pending]), /already processed/);
      assert.equal(Number(await scalar('select leave_balance from public.hr_employees where id=$1', [employee])), 7);
      assert.equal(Number(await scalar("select count(*) from public.hr_audit_events where action='leave.cancelled'")), 2);
    });
    await t.test('HR can view and withdraw only its company’s pending invitations', async () => {
      const list = 'select * from public.hr_list_invitations($1)';
      const cancel = 'select public.hr_cancel_invitation($1,$2,$3,$4)';
      const email = 'withdraw@example.com';
      await as(ids.hr);
      await db.query("select public.hr_add_member($1,$2,'employee')", [org, email]);
      assert.deepEqual((await db.query(list, [org])).rows, [{ email, role: 'employee', employee_id: null }]);
      for (const id of [ids.employee, ids.outsider]) {
        await as(id);
        assert.equal((await db.query(list, [org])).rows.length, 0);
        await assert.rejects(db.query(cancel, [org, email, 'employee', null]), /HR access required/);
      }
      await as(ids.hr);
      await assert.rejects(db.query(cancel, [org, email, 'manager', null]), /authorization changed/);
      await db.query(cancel, [org, email, 'employee', null]);
      assert.equal((await db.query(list, [org])).rows.length, 0);
      assert.equal(Number(await scalar("select count(*) from public.hr_audit_events where action='invitation.cancelled'")), 1);
      await db.exec('reset role');
      await assert.rejects(db.query("insert into auth.users values(gen_random_uuid(), $1, null, '{}')", [email]), /approval required/);
    });
    await t.test('contracts and payroll drafts are company-scoped, HR-only, audited and versioned', async () => {
      const contract = 'select public.hr_save_contract($1,$2,$3,$4,$5,$6,$7)';
      const draft = 'select public.hr_save_payroll_draft($1,$2,$3,$4,$5,$6)';
      await as(ids.hr);
      await db.query(contract, [org, employee, 'Employment agreement', '2027-01-01', null, null, null]);
      const id = await scalar('select id from public.hr_contracts');
      await db.query('select public.hr_review_contract($1,$2,1)', [org, id]);
      await assert.rejects(db.query('select public.hr_review_contract($1,$2,1)', [org, id]), /Contract changed/);
      await db.query(contract, [org, employee, 'Updated agreement', '2027-01-01', '2027-12-31', id, 2]);
      assert.equal(await scalar('select reviewed_at from public.hr_contracts'), null);
      await db.query(draft, [org, employee, '2027-01-01', 900000, 12345, null]);
      await assert.rejects(db.query(draft, [org, employee, '2027-01-01', 0, 0, null]), /Payroll draft changed/);
      await db.query(draft, [org, employee, '2027-01-01', 910000, 12345, 1]);
      await assert.rejects(db.query(draft, [org, employee, '2027-01-01', 0, 0, 1]), /Payroll draft changed/);
      assert.equal(Number(await scalar('select base_minor + additional_minor from public.hr_payroll_drafts')), 922345);
      assert.equal(Number(await scalar("select count(*) from public.hr_audit_events where action like 'contract.%' or action = 'payroll.draft_saved'")), 5);
      await assert.rejects(db.query('update public.hr_payroll_drafts set base_minor = 0'));
      for (const user of [ids.employee, ids.manager, ids.outsider]) {
        await as(user);
        assert.equal((await db.query('select * from public.hr_contracts')).rows.length, 0);
        assert.equal((await db.query('select * from public.hr_payroll_drafts')).rows.length, 0);
        await assert.rejects(db.query(contract, [org, employee, 'Changed', '2027-01-01', null, id, 3]), /HR access required/);
        await assert.rejects(db.query(draft, [org, employee, '2027-01-01', 0, 0, 2]), /HR access required/);
      }
      const otherOrg = await scalar('select id from public.hr_organizations');
      await assert.rejects(db.query(draft, [otherOrg, employee, '2027-01-01', 0, 0, null]), /foreign key/);
      await assert.rejects(db.query(contract, [otherOrg, employee, 'Wrong company', '2027-01-01', null, null, null]), /foreign key/);
    });
    await t.test('HR can demote and revoke company members while retaining employee and leave records', async () => {
      const manage = 'select public.hr_manage_member($1,$2,$3,$4)';
      await as(ids.employee);
      await assert.rejects(db.query(manage, [org, ids.manager, 'manager', 'hr']), /HR access required/);
      await as(ids.outsider);
      await assert.rejects(db.query(manage, [org, ids.manager, 'manager', null]), /HR access required/);
      await as(ids.hr);
      await assert.rejects(db.query(manage, [org, ids.hr, 'hr', null]), /protected/);
      await assert.rejects(db.query(manage, [org, ids.manager, 'employee', null]), /access changed/);
      await db.query(manage, [org, ids.manager, 'manager', 'employee']);
      assert.equal(await scalar('select manager_user_id from public.hr_employees where id=$1', [employee]), null);
      await as(ids.manager);
      assert.equal((await db.query('select * from public.hr_employees')).rows.length, 0);
      await as(ids.hr);
      await db.query(manage, [org, ids.employee, 'employee', null]);
      assert.equal(await scalar('select user_id from public.hr_employees where id=$1', [employee]), null);
      assert.equal(await scalar('select status from public.hr_leave_requests where id=$1', [request!]), 'Approved');
      assert.equal(Number(await scalar("select count(*) from public.hr_audit_events where action in ('member.role_changed.employee','member.revoked')")), 2);
      await as(ids.employee);
      assert.equal((await db.query('select * from public.hr_organizations')).rows.length, 0);
      assert.equal((await db.query('select * from public.hr_leave_requests')).rows.length, 0);
    });
    await t.test('company settings validate and isolate profiles, pay points and employee numbering', async () => {
      const saveProfile = 'select public.hr_save_company_profile($1,$2,$3,$4)';
      const saveNumbering = "select public.hr_save_numbering($1,$2,$3,'FAC','-',4,1,false,true,true)";
      const hire = "select public.hr_save_employee($1,'New Hire','Designer','Design',$2,10,p_staff_number => $3,p_pay_point_id => $4)";
      const details = { work_days: [1, 2, 6], payment_method: 'bank', workers_compensation: true, tpin: '0123456789', email: 'ops@example.com' };
      await as(ids.hr);
      assert.match(await scalar('select account_number from public.hr_organizations where id=$1', [org]), /^EH-[0-9]+$/);
      assert.equal(await scalar('select staff_number from public.hr_employees where id=$1', [employee]), 'EMP0001');
      await assert.rejects(db.query(saveProfile, [org, 'New company name', { ...details, work_days: [1, 1] }, 0]), /working days/);
      await assert.rejects(db.query(saveProfile, [org, 'New company name', { ...details, tpin: '1234' }, 0]), /statutory/);
      await db.query(saveProfile, [org, 'New company name', details, 0]);
      assert.equal(await scalar('select name from public.hr_organizations where id=$1', [org]), 'New company name');
      assert.equal(await scalar("select profile->>'tpin' from public.hr_company_settings"), '0123456789');
      await assert.rejects(db.query(saveProfile, [org, 'Stale name', details, 0]), /profile changed/);
      const point = await scalar("select public.hr_add_pay_point($1,'Ndola','ndl')", [org]);
      await assert.rejects(db.query("select public.hr_add_pay_point($1,'NDOLA','OTHER')", [org]), /hr_pay_point_name/);
      const version = Number(await scalar('select numbering_version from public.hr_company_settings'));
      await db.query(saveNumbering, [org, version, true]);
      const first = await scalar(hire, [org, 'first@example.com', null, point]);
      assert.equal(await scalar('select staff_number from public.hr_employees where id=$1', [first]), 'NDL-FAC-0001');
      await assert.rejects(db.query(saveNumbering, [org, version + 1, false]), /Numbering changed/);
      await db.query(saveNumbering, [org, version + 2, true]);
      const second = await scalar(hire, [org, 'second@example.com', null, point]);
      assert.equal(await scalar('select staff_number from public.hr_employees where id=$1', [second]), 'NDL-FAC-0002');
      await db.query(saveNumbering, [org, version + 4, false]);
      await assert.rejects(db.query(hire, [org, 'manual@example.com', null, null]), /Enter an employee number/);
      await assert.rejects(db.query(hire, [org, 'manual@example.com', 'ndl-fac-0001', null]), /already exists/);
      const manual = await scalar(hire, [org, 'manual@example.com', 'legacy-007', null]);
      assert.equal(await scalar('select staff_number from public.hr_employees where id=$1', [manual]), 'LEGACY-007');
      await as(ids.outsider);
      const otherOrg = await scalar('select id from public.hr_organizations');
      assert.equal(Number(await scalar('select count(*) from public.hr_pay_points')), 0);
      assert.equal(Number(await scalar('select count(*) from public.hr_company_settings where organization_id=$1', [org])), 0);
      await assert.rejects(db.query(saveProfile, [org, 'Cross-company edit', details, 1]), /HR access required/);
      await assert.rejects(db.query(hire, [otherOrg, 'wrong-point@example.com', null, point]), /Choose a pay point in this company/);
    });
    await t.test('anonymous sessions cannot read tables or execute write functions', async () => {
      await db.exec('reset role; set role anon');
      await assert.rejects(db.query('select * from public.hr_employees'));
      await assert.rejects(db.query('select public.hr_activate_workspace()'));
      await assert.rejects(db.query('select public.hr_cancel_leave(null)'));
      await assert.rejects(db.query('select public.hr_list_invitations(null)'));
      await assert.rejects(db.query('select * from public.hr_payroll_drafts'));
      await assert.rejects(db.query('select * from public.hr_contracts'));
      await assert.rejects(db.query('select * from public.hr_company_settings'));
      await assert.rejects(db.query('select * from public.hr_pay_points'));
    });
  } finally { await db.close(); }
});

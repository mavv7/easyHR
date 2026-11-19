import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Tests database behavior as real PostgreSQL roles. All fixture rows are rolled back.
// This does not test email delivery, Supabase Auth login, or physical device UI.
export async function verifyLiveWorkflow(client) {
  const hr = randomUUID(), employee = randomUUID(), outsider = randomUUID();
  const email = `${employee}@example.invalid`;
  const as = async id => {
    await client.query('reset role');
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    await client.query('set local role authenticated');
  };
  const scalar = async (sql, args = []) => Object.values((await client.query(sql, args)).rows[0])[0];
  const denied = async (sql, args = [], expectedCode = 'P0001') => {
    await client.query('savepoint expected_denial');
    let code;
    try { await client.query(sql, args); } catch (error) { code = error.code; }
    await client.query('rollback to savepoint expected_denial');
    await client.query('release savepoint expected_denial');
    assert.equal(code, expectedCode, 'Operation must be denied for the expected reason');
  };
  await client.query('begin');
  try {
    for (const id of [hr, outsider]) {
      const phone = '1999' + String(BigInt('0x' + id.slice(-12)) % 10000000n).padStart(7, '0');
      await client.query(`insert into auth.users(id,aud,role,email,email_confirmed_at,phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
        values($1,'authenticated','authenticated',$2,now(),$3,now(),'{}',$4,now(),now())`, [id, `${id}@example.invalid`, phone, {
        company_name: `Verification company ${id}`, company_type: 'limited_company', tpin: '0123456789', registration_phone: '+' + phone,
      }]);
    }
    await as(hr);
    await client.query('select public.hr_activate_workspace()');
    const org = await scalar('select id from public.hr_organizations');
    const record = await scalar("select public.hr_save_employee($1,'Verification employee','Designer','Design',$2,10)", [org, email]);
    await client.query("select public.hr_add_member($1,$2,'employee',$3)", [org, email, record]);
    await client.query('reset role');
    await client.query(`insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values($1,'authenticated','authenticated',$2,now(),'{}','{}',now(),now())`, [employee, email]);
    await as(employee);
    await client.query('select public.hr_activate_workspace()');
    assert.equal(Number(await scalar('select count(*) from public.hr_employees')), 1);
    await denied('update public.hr_employees set leave_balance=100 where id=$1', [record], '42501');
    const request = await scalar("select public.hr_request_leave($1,'2027-03-01','2027-03-03','Temporary test request')", [record]);
    await denied('select public.hr_decide_leave($1,true)', [request]);
    await as(outsider);
    await client.query('select public.hr_activate_workspace()');
    assert.notEqual(await scalar('select id from public.hr_organizations'), org);
    assert.equal(Number(await scalar('select count(*) from public.hr_employees')), 0);
    assert.equal(Number(await scalar('select count(*) from public.hr_leave_requests')), 0);
    await denied('select public.hr_decide_leave($1,true)', [request]);
    await as(hr);
    await client.query('select public.hr_decide_leave($1,true)', [request]);
    assert.equal(Number(await scalar('select leave_balance from public.hr_employees where id=$1', [record])), 7);
    assert.equal(await scalar('select status from public.hr_leave_requests where id=$1', [request]), 'Approved');
    await denied('select public.hr_decide_leave($1,true)', [request]);
    assert.equal(Number(await scalar('select leave_balance from public.hr_employees where id=$1', [record])), 7);
    assert.equal(Number(await scalar("select count(*) from public.hr_audit_events where organization_id=$1 and action='leave.approved'", [org])), 1);
    await client.query('reset role; set local role anon');
    await denied('select * from public.hr_employees limit 0', [], '42501');
    console.log('Live workflow passed: employee creation/linking, role isolation, leave request/approval, exact-once deduction and audit.');
  } finally {
    await client.query('rollback');
    console.log('Live verification transaction rolled back; no fixture users or HR records retained.');
  }
}

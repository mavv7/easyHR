import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyLiveWorkflow } from './verify-live-workflow.mjs';

const apply = process.argv.includes('--apply');
const host = process.env.PGHOST;
const user = process.env.PGUSER;
const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
if (!projectUrl) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL for the intended project.');
const project = new URL(projectUrl).hostname.split('.')[0];
if (!host?.endsWith('.pooler.supabase.com') || user !== `postgres.${project}`) {
  throw new Error('Set PGHOST and PGUSER for the same project as EXPO_PUBLIC_SUPABASE_URL.');
}
// Read from a hidden terminal prompt, never command-line arguments or saved files.
async function readPassword() {
  if (!process.stdin.isTTY) throw new Error('An interactive terminal is required for the hidden password prompt.');
  process.stdout.write('Database password (hidden): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const listener = chunk => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n' || char === '\u0003') {
          process.stdin.removeListener('data', listener);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          if (char === '\u0003') reject(new Error('Cancelled')); else resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1); else value += char;
      }
    };
    process.stdin.on('data', listener);
  });
}
// Supabase poolers use Supabase's CA, fetched over certificate-verified HTTPS.
// Do not disable TLS verification to work around the private CA chain.
// URL published in Supabase Studio's hooks/custom-content/custom-content.json.
const caResponse = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { signal: AbortSignal.timeout(15000) });
if (!caResponse.ok) throw new Error('Could not download the official Supabase CA certificate.');
const ca = await caResponse.text();
if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('Invalid Supabase CA response.');
const client = new Client({ host, user, password: await readPassword(), database: 'postgres', port: 5432,
  ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 20000, statement_timeout: 30000, application_name: 'easyhr-migration' });
try {
  await client.connect();
  console.log(`Connected to project ${project} with certificate-verified TLS.`);
  const existing = await client.query("select tablename from pg_tables where schemaname='public' and tablename like 'hr_%' order by tablename");
  console.log('Existing HR tables:', existing.rows.map(r => r.tablename));
  if (apply) {
    await client.query('begin');
    await client.query("set local lock_timeout = '5s'");
    await client.query("select pg_advisory_xact_lock(hashtext('easyhr-foundation-migration'))");
    for (const file of [
      '202611180001_hr_foundation.sql',
      '202611180002_company_signup.sql',
      '202611180003_manage_members.sql',
      '202611180004_pending_requests.sql',
      '202611180005_contracts_payroll.sql',
      '202611190006_company_settings.sql',
      '202611190007_company_signup_otp.sql',
      '202611190008_employee_onboarding.sql',
    ]) {
      const version = file.split('_')[0];
      const migration = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
      const checksum = createHash('sha256').update(migration.replace(/\r\n/g, '\n')).digest('hex');
      const rawChecksum = createHash('sha256').update(migration).digest('hex');
      const crlfChecksum = createHash('sha256').update(migration.replace(/\r?\n/g, '\r\n')).digest('hex');
      const ledger = await client.query("select to_regclass('easyhr_private.schema_migrations') as ledger");
      const recorded = ledger.rows[0].ledger
        ? (await client.query('select checksum from easyhr_private.schema_migrations where version=$1', [version])).rows[0]
        : undefined;
      if (recorded) {
        if (![checksum, rawChecksum, crlfChecksum].includes(recorded.checksum)) throw new Error(`Migration ${version} checksum differs.`);
        console.log(`Migration ${version} already applied with matching checksum.`);
        continue;
      }
      if (version === '202611180001' && existing.rows.length) {
        throw new Error('Existing HR tables require manual inspection; refusing to overwrite them.');
      }
      await client.query(migration.replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, ''));
      await client.query('create table if not exists easyhr_private.schema_migrations(version text primary key, checksum text not null, applied_at timestamptz not null default now())');
      await client.query('revoke all on easyhr_private.schema_migrations from public, anon, authenticated');
      await client.query('insert into easyhr_private.schema_migrations(version,checksum) values($1,$2)', [version, checksum]);
      console.log(`Migration ${version} executed.`);
    }
    await client.query("notify pgrst, 'reload schema'");
    await client.query('commit');
    console.log('Migration committed.');
  }
  const security = await client.query(`select c.relname as table_name, c.relrowsecurity as rls,
    has_table_privilege('anon',c.oid,'SELECT') as anon_select,
    has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as direct_write,
    (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname like 'hr_%' order by c.relname`);
  console.log(JSON.stringify(security.rows, null, 2));
  if (security.rows.length !== 9 || security.rows.some(r => !r.rls || r.anon_select || r.direct_write || !r.policies)) throw new Error('Schema/access verification failed.');
  const functions = await client.query(`select p.proname, p.prosecdef,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hr_%'`);
  const signupRpc = functions.rows.find(f => f.proname === 'hr_company_signup_available');
  const protectedRpcs = functions.rows.filter(f => f.proname !== 'hr_company_signup_available');
  if (!signupRpc?.anon_execute || signupRpc.prosecdef || !signupRpc.authenticated_execute ||
      protectedRpcs.some(f => !f.prosecdef || f.anon_execute || !f.authenticated_execute) ||
      !protectedRpcs.some(f => f.proname === 'hr_save_employee_access') ||
      !protectedRpcs.some(f => f.proname === 'hr_pending_employee_phone')) throw new Error('RPC permissions verification failed.');
  console.log(`Verified ${security.rows.length} tables and ${functions.rows.length} RPC permissions.`);
  if (process.argv.includes('--verify-workflow')) await verifyLiveWorkflow(client);
} catch (error) {
  await client.query('rollback').catch(() => {});
  // Never emit connection configuration or a stack containing credentials.
  console.error(`Database operation failed: ${error.code || error.name}: ${error.message}`);
  process.exitCode = 1;
} finally { await client.end(); }

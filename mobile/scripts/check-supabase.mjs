// Read-only deployment check. Never prints credentials or employee records.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Load .env.local with node --env-file=.env.local scripts/check-supabase.mjs');
const tables = ['hr_organizations', 'hr_members', 'hr_employees', 'hr_leave_requests', 'hr_audit_events'];
for (const table of tables) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  console.log(JSON.stringify({ table, status: response.status, code: body.code, message: body.message }));
  // Permission denied is expected for anonymous users after the migration.
  if (!response.ok && body.code !== '42501') process.exitCode = 1;
}

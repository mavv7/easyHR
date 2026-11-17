import { supabase } from './client';
export type Organization = { id: string; name: string; owner_id: string };
export type Member = { user_id: string; role: 'hr' | 'manager' | 'employee' };
export type CloudEmployee = { id: string; organization_id: string; user_id: string | null; manager_user_id: string | null; name: string; job_title: string; department: string; email: string; leave_balance: number; version: number };
export type CloudLeave = { id: string; employee_id: string; start_date: string; end_date: string; days: number; reason: string; status: 'Pending' | 'Approved' | 'Declined' };
export type Audit = { id: number; action: string; created_at: string; actor_id: string; record_id: string };
export type Snapshot = { employees: CloudEmployee[]; leave: CloudLeave[]; members: Member[]; audit: Audit[] };
export const emptySnapshot: Snapshot = { employees: [], leave: [], members: [], audit: [] };
export async function loadOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase!.from('hr_organizations').select('id,name,owner_id').order('created_at');
  if (error) throw error; return data || [];
}
export async function loadSnapshot(org: string): Promise<Snapshot> {
  const results = await Promise.all([
    supabase!.from('hr_employees').select('*').eq('organization_id', org).order('name'),
    supabase!.from('hr_leave_requests').select('*').eq('organization_id', org).order('created_at', { ascending: false }),
    supabase!.from('hr_members').select('user_id,role').eq('organization_id', org),
    supabase!.from('hr_audit_events').select('*').eq('organization_id', org).order('created_at', { ascending: false }).limit(100),
  ]);
  for (const result of results) if (result.error) throw result.error;
  return { employees: results[0].data || [], leave: results[1].data || [], members: results[2].data || [], audit: results[3].data || [] };
}
export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase!.rpc(name, args);
  if (error) throw error; return data;
}

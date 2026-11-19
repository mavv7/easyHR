import { supabase } from './client';
import { collectPages } from './pagination';
export type Organization = { id: string; name: string; owner_id: string };
export type Member = { user_id: string; role: 'hr' | 'manager' | 'employee' };
export type CloudEmployee = { id: string; organization_id: string; user_id: string | null; manager_user_id: string | null; name: string; job_title: string; department: string; email: string; phone?: string | null; leave_balance: number; version: number; staff_number?: string | null; pay_point_id?: string | null };
export type CloudLeave = { id: string; employee_id: string; created_at: string; start_date: string; end_date: string; days: number; reason: string; status: 'Pending' | 'Approved' | 'Declined' | 'Cancelled' };
export type Audit = { id: number; action: string; created_at: string; actor_id: string; record_id: string | null };
export type Invitation = { email: string; role: Member['role']; employee_id: string | null };
export type Contract = { id: string; employee_id: string; title: string; start_date: string; end_date: string | null; reviewed_at: string | null; version: number };
export type PayrollDraft = { id: string; employee_id: string; base_minor: number; additional_minor: number; version: number };
export type CompanyProfile = {
  work_days: number[]; payment_method: string; workers_compensation: boolean;
} & Partial<Record<'phone' | 'address' | 'city' | 'email' | 'legal_name' | 'trading_name' | 'registration_number' |
  'postal_address' | 'industry' | 'business' | 'signatory' | 'signatory_title' | 'pay_day' | 'tpin' | 'napsa' | 'nhima', string>>;
export type NumberingPolicy = {
  automatic: boolean; prefix: string; separator: string; digits: number; next_number: number;
  include_year: boolean; include_branch: boolean; separate_number: boolean;
};
export type PayPoint = { id: string; name: string; code: string | null };
export type CompanySettings = NumberingPolicy & { profile: CompanyProfile; profile_version: number; numbering_version: number; company_type?: string | null };
export type Snapshot = { employees: CloudEmployee[]; leave: CloudLeave[]; members: Member[]; audit: Audit[]; invitations: Invitation[] | null; payPoints: PayPoint[] };
export const emptySnapshot: Snapshot = { employees: [], leave: [], members: [], audit: [], invitations: null, payPoints: [] };

export async function loadPendingPhone() {
  for (const kind of ['company', 'employee'] as const) {
    const { data, error } = await supabase!.rpc(`hr_pending_${kind}_phone`);
    if (error && error.code !== 'PGRST202') throw error;
    if (typeof data === 'string') return { kind, phone: data };
  }
  return null;
}

export async function loadCompanySettings(org: string) {
  const { data, error } = await supabase!.from('hr_company_settings')
    .select('*,hr_organizations(name,account_number)').eq('organization_id', org).single();
  if (error) throw error;
  return data as CompanySettings & { hr_organizations: { name: string; account_number: string } };
}

type WorkspacePage<T> = {
  order: (column: string) => WorkspacePage<T>;
  limit: (size: number) => WorkspacePage<T>;
  gt: (column: string, cursor: string) => WorkspacePage<T>;
} & PromiseLike<{ data: T[] | null; error: unknown }>;

function readRows<T, K extends keyof T & string>(query: () => WorkspacePage<T>, key: K) {
  return collectPages(after => {
    const page = query().order(key).limit(250);
    return after === null ? page : page.gt(key, after);
  }, row => String(row[key]));
}

export async function loadOrganizations(): Promise<Organization[]> {
  const organizations = await readRows<Organization & { created_at: string }, 'id'>(
    () => supabase!.from('hr_organizations').select('id,name,owner_id,created_at'), 'id',
  );
  return organizations.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export async function loadAuditPage(org: string, before?: Pick<Audit, 'created_at' | 'id'>): Promise<Audit[]> {
  const query = supabase!.from('hr_audit_events').select('id,action,created_at,actor_id,record_id')
    .eq('organization_id', org).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
  if (before) {
    const timestamp = `"${before.created_at}"`;
    query.or(`created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${before.id})`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export function loadContracts(org: string) {
  return readRows<Contract, 'id'>(() => supabase!.from('hr_contracts').select('id,employee_id,title,start_date,end_date,reviewed_at,version')
    .eq('organization_id', org), 'id');
}

export function loadPayrollDrafts(org: string, period: string) {
  return readRows<PayrollDraft, 'id'>(() => supabase!.from('hr_payroll_drafts').select('id,employee_id,base_minor,additional_minor,version')
    .eq('organization_id', org).eq('period', period), 'id');
}

export async function loadSnapshot(org: string, userId: string): Promise<Snapshot> {
  const [employees, leave, members, audit] = await Promise.all([
    readRows<CloudEmployee, 'id'>(() => supabase!.from('hr_employees').select('*').eq('organization_id', org), 'id'),
    readRows<CloudLeave, 'id'>(() => supabase!.from('hr_leave_requests').select('*').eq('organization_id', org), 'id'),
    readRows<Member, 'user_id'>(() => supabase!.from('hr_members').select('user_id,role').eq('organization_id', org), 'user_id'),
    loadAuditPage(org),
  ]);
  let invitations: Invitation[] | null = null;
  let payPoints: PayPoint[] = [];
  if (members.some(member => member.user_id === userId && member.role === 'hr')) {
    try {
      invitations = await readRows<Invitation, 'email'>(() => supabase!.rpc('hr_list_invitations', { p_organization_id: org }), 'email');
    } catch (error) {
      if (typeof error !== 'object' || !error || !('code' in error) || error.code !== 'PGRST202') throw error;
    }
    if (employees.some(employee => 'staff_number' in employee) || !employees.length) {
      try {
        payPoints = await readRows<PayPoint, 'id'>(() => supabase!.from('hr_pay_points').select('id,name,code').eq('organization_id', org), 'id');
        payPoints.sort((a, b) => a.name.localeCompare(b.name));
      } catch (error) {
        if (typeof error !== 'object' || !error || !('code' in error) || !['PGRST205', '42P01'].includes(String(error.code))) throw error;
      }
    }
  }
  employees.sort((a, b) => a.name.localeCompare(b.name));
  leave.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return { employees, leave, members, audit, invitations, payPoints };
}
export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase!.rpc(name, args);
  if (error) throw error; return data;
}

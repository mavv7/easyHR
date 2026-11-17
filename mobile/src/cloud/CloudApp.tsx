import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Session } from '@supabase/supabase-js';
import { router, useLocalSearchParams } from 'expo-router';
import { configured, supabase } from './client';
import { CloudEmployee, emptySnapshot, loadOrganizations, loadSnapshot, Member, Organization, rpc, Snapshot } from './api';
import { weekdays } from '../domain';

function Button({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button, secondary && s.secondary, disabled && { opacity: 0.45 }]}><Text style={[s.buttonText, secondary && { color: '#24352C' }]}>{label}</Text></Pressable>;
}
function Field({ label, value, onChange, secure = false }: { label: string; value: string; onChange: (v: string) => void; secure?: boolean }) {
  return <View style={{ gap: 6 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} style={s.input} /></View>;
}
export default function CloudApp({ onDemo }: { onDemo: () => void }) {
  const [session, setSession] = useState<Session | null>(null), [loading, setLoading] = useState(configured), [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { if (live) { setSession(next); setLoading(false); } });
    supabase.auth.getSession().then(({ data, error: err }) => { if (live) { if (err) setError(err.message); setSession(data.session); setLoading(false); } }).catch(err => { if (live) { setError(err.message); setLoading(false); } });
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') supabase!.auth.startAutoRefresh(); else supabase!.auth.stopAutoRefresh(); });
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    return () => { live = false; subscription.unsubscribe(); foreground.remove(); supabase!.auth.stopAutoRefresh(); };
  }, []);
  return <SafeAreaProvider><SafeAreaView style={s.root}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {loading ? <Text style={s.loading}>Opening your workspace…</Text> : session ? <CompanyWorkspace key={session.user.id} session={session} /> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.auth}>
      <Text style={s.logo}>easy<Text style={{ color: '#ED631C' }}>HR.</Text></Text><Text style={s.title}>Your people, connected.</Text><Text style={s.subtitle}>Secure company workspaces · Zambia</Text>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {configured ? <SignIn /> : <View style={s.card}><Text style={s.heading}>Connect your Supabase project</Text><Text style={s.subtitle}>Add your project URL and publishable key to mobile/.env.local, apply the database migration, then restart Expo. Setup steps are in docs/supabase-setup.md.</Text></View>}
      <Button label="Explore fictional demo" onPress={onDemo} secondary />
    </ScrollView>}
  </KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>;
}
function SignIn() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [mode, setMode] = useState<'signin' | 'company' | 'member'>('signin');
  const [company, setCompany] = useState('');
  async function authenticate() {
    const signup = mode !== 'signin';
    if (busy) return;
    if (mode === 'company' && (company.trim().length < 2 || company.trim().length > 120)) {
      setMessage('Enter a company name between 2 and 120 characters.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 8) { setMessage('Enter a valid email and a password of at least 8 characters.'); return; }
    setBusy(true); setMessage('');
    try {
      const credentials = { email: email.trim(), password };
      const result = signup
        ? await supabase!.auth.signUp({ ...credentials, options: { data: mode === 'company' ? { company_name: company.trim() } : { join_workspace: true } } })
        : await supabase!.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      if (signup && !result.data.session) setMessage('Check your email to confirm your account, then return here and sign in.');
      setPassword('');
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  }
  return <View style={s.card}>
    <Text style={s.heading}>{mode === 'company' ? 'Register your company' : mode === 'member' ? 'Activate company access' : 'Sign in to easyHR'}</Text>
    {mode === 'company' && <Field label="Company name" value={company} onChange={setCompany} />}
    {mode === 'member' && <Text style={s.subtitle}>Use the work email your HR administrator authorized.</Text>}
    <Field label="Work email" value={email} onChange={setEmail} />
    <Field label="Password" value={password} onChange={setPassword} secure />
    {!!message && <Text accessibilityRole="alert" style={s.subtitle}>{message}</Text>}
    <Button label={busy ? 'Please wait…' : mode === 'company' ? 'Register company' : mode === 'member' ? 'Activate access' : 'Sign in'} disabled={busy} onPress={() => void authenticate()} />
    {mode === 'signin' ? <>
      <Button label="Register a company" disabled={busy} onPress={() => { setMode('company'); setMessage(''); }} secondary />
      <Button label="Activate HR-approved access" disabled={busy} onPress={() => { setMode('member'); setMessage(''); }} secondary />
    </> : <Button label="Back to sign in" disabled={busy} onPress={() => { setMode('signin'); setMessage(''); }} secondary />}
  </View>;
}
function CompanyWorkspace({ session }: { session: Session }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]), [org, setOrg] = useState(''), [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false), [fetching, setFetching] = useState(true), [message, setMessage] = useState('');
  const [editor, setEditor] = useState<CloudEmployee | 'new' | null>(null), [showLeave, setShowLeave] = useState(false), [showAccess, setShowAccess] = useState(false), [search, setSearch] = useState('');
  const generation = useRef(0), mounted = useRef(true), mutation = useRef(false);
  const params = useLocalSearchParams<{ cloudtab?: string }>();
  const tab = ['People', 'Leave', 'Activity', 'Workspace'].includes(params.cloudtab || '') ? params.cloudtab! : 'People';
  const membership = snapshot.members.find(m => m.user_id === session.user.id), isHR = membership?.role === 'hr';
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setFetching(true);
    try {
      if (!org) await rpc('hr_activate_workspace', {});
      const list = await loadOrganizations();
      const selected = list.some(o => o.id === org) ? org : list[0]?.id || '';
      const data = selected ? await loadSnapshot(selected) : emptySnapshot;
      if (mounted.current && ticket === generation.current) { setOrganizations(list); setOrg(selected); setSnapshot(data); }
    } catch (err) { if (mounted.current && ticket === generation.current) { setSnapshot(emptySnapshot); setMessage((err as Error).message); } }
    finally { if (mounted.current && ticket === generation.current) setFetching(false); }
  }, [org]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const initial = setTimeout(() => void refresh(), 0); const interval = setInterval(() => { if (AppState.currentState === 'active' && !mutation.current) void refresh(); }, 30000); const sub = AppState.addEventListener('change', state => { if (state === 'active' && !mutation.current) void refresh(); }); return () => { clearTimeout(initial); clearInterval(interval); sub.remove(); }; }, [refresh]);
  async function act(work: () => Promise<unknown>, success: string) {
    if (mutation.current) return false;
    mutation.current = true; setBusy(true); setMessage('');
    try { await work(); if (mounted.current) { setMessage(success); await refresh(); } return true; }
    catch (err) { if (mounted.current) setMessage((err as Error).message); return false; }
    finally { mutation.current = false; if (mounted.current) setBusy(false); }
  }
  const currentName = organizations.find(o => o.id === org)?.name;
  const eligible = snapshot.employees.filter(e => isHR || e.user_id === session.user.id);
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <View style={s.row}><View style={{ flex: 1 }}><Text style={s.logo}>easy<Text style={{ color: '#ED631C' }}>HR.</Text></Text><Text style={s.subtitle}>{currentName || 'Your workspace'} · Zambia · ZMW</Text></View><Button label="Sign out" disabled={busy} secondary onPress={() => void act(async () => { const { error } = await supabase!.auth.signOut({ scope: 'local' }); if (error) throw error; }, 'Signed out')} /></View>
    <Text style={s.small}>{session.user.email} · {membership?.role?.toUpperCase() || 'No company role yet'}</Text>
    {!!message && <Text accessibilityRole="alert" style={s.message}>{message}</Text>}
    <View style={s.row}><Button label={fetching ? 'Refreshing…' : 'Refresh'} onPress={() => void refresh()} disabled={fetching || busy} secondary /><Text style={s.small}>Refreshes every 30 seconds while active.</Text></View>
    {!org && !fetching && <View style={s.card}><Text style={s.heading}>Waiting for company access</Text><Text style={s.subtitle}>Confirm your work email or ask your HR administrator to authorize access, then refresh.</Text></View>}
    {!!org && <>
      {organizations.length > 1 && <View style={s.row}>{organizations.map(o => <Button key={o.id} label={o.name} disabled={busy || fetching} secondary={org !== o.id} onPress={() => { generation.current++; setSnapshot(emptySnapshot); setEditor(null); setShowLeave(false); setShowAccess(false); setOrg(o.id); }} />)}</View>}
      <View style={s.row}>{['People', 'Leave', ...(isHR ? ['Activity', 'Workspace'] : [])].map(t => <Button key={t} label={t} secondary={tab !== t} onPress={() => { router.setParams({ cloudtab: t }); setEditor(null); setShowLeave(false); setShowAccess(false); }} />)}</View>
      {tab === 'People' && <View style={s.card}><View style={s.row}><Text style={s.heading}>People · {snapshot.employees.length}</Text>{isHR && <Button label="Add employee" disabled={busy} onPress={() => setEditor('new')} />}</View><Field label="Search people" value={search} onChange={setSearch} />
        {editor && isHR && <EmployeeForm key={editor === 'new' ? 'new' : editor.id} employee={editor} snapshot={snapshot} busy={busy} onCancel={() => setEditor(null)} onSave={async values => { const ok = await act(() => rpc('hr_save_employee', { p_organization_id: org, ...values }), 'Employee saved'); if (ok) setEditor(null); }} />}
        {snapshot.employees.filter(e => `${e.name} ${e.department} ${e.job_title}`.toLowerCase().includes(search.toLowerCase())).map(e => <View key={e.id} style={s.listItem}><View style={{ flex: 1, gap: 5 }}><Text style={s.heading}>{e.name}</Text><Text style={s.subtitle}>{e.job_title} · {e.department}</Text><Text style={s.small}>{e.email}</Text><Text style={s.label}>{e.leave_balance} days available · {e.user_id ? 'Account linked' : 'Account not linked'}</Text></View>{isHR && <Button label="Edit" secondary disabled={busy} onPress={() => setEditor(e)} />}</View>)}
        {!snapshot.employees.length && <Text style={s.subtitle}>{isHR ? 'Add your first employee to get started.' : 'No employee records are assigned to your account yet.'}</Text>}
      </View>}
      {tab === 'Leave' && <View style={s.card}><Text style={s.heading}>Leave requests</Text><Text style={s.small}>Current policy: whole weekdays only. Public holidays and statutory accrual are not configured. Pending requests reserve available days.</Text><Button label="Request leave" disabled={busy || !eligible.length} onPress={() => setShowLeave(true)} />
        {showLeave && <LeaveForm employees={eligible} busy={busy} onCancel={() => setShowLeave(false)} onSave={async values => { const ok = await act(() => rpc('hr_request_leave', values), 'Leave submitted'); if (ok) setShowLeave(false); }} />}
        {!snapshot.leave.length && <Text style={s.subtitle}>No leave requests yet.</Text>}
        {snapshot.leave.map(l => { const e = snapshot.employees.find(e => e.id === l.employee_id); const canApprove = e?.user_id !== session.user.id && (isHR || (membership?.role === 'manager' && e?.manager_user_id === session.user.id)); return <View key={l.id} style={s.card}><Text style={s.heading}>{e?.name || 'Employee'}</Text><Text style={s.subtitle}>{l.start_date} → {l.end_date} · {l.days} days</Text><Text>{l.reason}</Text><Text style={s.label}>{l.status}</Text>{l.status === 'Pending' && canApprove && <View style={s.row}><Button label="Approve" disabled={busy} onPress={() => void act(() => rpc('hr_decide_leave', { p_id: l.id, p_approve: true }), 'Leave approved and balance updated')} /><Button label="Decline" disabled={busy} secondary onPress={() => void act(() => rpc('hr_decide_leave', { p_id: l.id, p_approve: false }), 'Leave declined')} /></View>}</View>; })}
      </View>}
      {tab === 'Activity' && isHR && <View style={s.card}><Text style={s.heading}>Server activity history</Text><Text style={s.small}>Latest 100 events. Events are written by database functions and cannot be edited by app users.</Text>{snapshot.audit.map(a => <View key={a.id} style={s.listItem}><View><Text style={s.label}>{a.action}</Text><Text style={s.small}>{new Date(a.created_at).toLocaleString()}</Text><Text selectable style={s.small}>Actor: {a.actor_id}</Text><Text selectable style={s.small}>Record: {a.record_id}</Text></View></View>)}</View>}
      {tab === 'Workspace' && isHR && <View style={s.card}><Text style={s.heading}>Workspace access</Text><Text style={s.subtitle}>Authorize a work email and role, then ask the team member to activate company access. Existing verified accounts receive access immediately.</Text><Button label="Grant access / link account" onPress={() => setShowAccess(true)} disabled={busy} />{showAccess && <AccessForm employees={snapshot.employees} busy={busy} onCancel={() => setShowAccess(false)} onSave={async values => { const ok = await act(() => rpc('hr_add_member', { p_organization_id: org, ...values }), 'Workspace access authorization saved'); if (ok) setShowAccess(false); }} />}{snapshot.members.map(member => <MemberAccess
        key={`${org}:${member.user_id}:${member.role}`}
        member={member}
        name={snapshot.employees.find(e => e.user_id === member.user_id)?.name || (member.user_id === session.user.id ? session.user.email : member.user_id)}
        protectedAccess={member.user_id === session.user.id || member.user_id === organizations.find(o => o.id === org)?.owner_id}
        busy={busy}
        onSave={role => act(() => rpc('hr_manage_member', {
          p_organization_id: org, p_user_id: member.user_id, p_expected_role: member.role, p_role: role,
        }), role ? 'Workspace role updated' : 'Workspace access revoked')}
      />)}</View>}
    </>}
    <Text style={s.small}>Connected MVP: employee records and leave. Payroll, contracts, attendance and compliance remain in the separate fictional demo.</Text>
  </ScrollView>;
}
type SaveForm = { busy: boolean; onCancel: () => void; onSave: (values: Record<string, unknown>) => Promise<void> };
function EmployeeForm({ employee, snapshot, busy, onCancel, onSave }: SaveForm & { employee: CloudEmployee | 'new'; snapshot: Snapshot }) {
  const e = employee === 'new' ? null : employee;
  const [name, setName] = useState(e?.name || ''), [job, setJob] = useState(e?.job_title || ''), [department, setDepartment] = useState(e?.department || ''), [email, setEmail] = useState(e?.email || ''), [balance, setBalance] = useState(String(e?.leave_balance || 0)), [manager, setManager] = useState<string | null>(e?.manager_user_id || null), [error, setError] = useState('');
  function save() {
    if (name.trim().length < 2 || !job.trim() || !department.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !/^\d+$/.test(balance) || Number(balance) > 366) { setError('Complete all fields. Leave balance must be a whole number from 0 to 366.'); return; }
    void onSave({ p_id: e?.id || null, p_version: e?.version || null, p_name: name, p_job_title: job, p_department: department, p_email: email, p_leave_balance: Number(balance), p_manager_user_id: manager });
  }
  return <View style={s.form}><Text style={s.heading}>{e ? 'Edit employee' : 'New employee'}</Text><Field label="Full name" value={name} onChange={setName} /><Field label="Job title" value={job} onChange={setJob} /><Field label="Department" value={department} onChange={setDepartment} /><Field label="Work email" value={email} onChange={setEmail} /><Field label="Available leave days" value={balance} onChange={setBalance} /><Text style={s.label}>Approving manager</Text><View style={s.row}><Button label="No manager" secondary={manager !== null} onPress={() => setManager(null)} />{snapshot.members.filter(m => ['hr', 'manager'].includes(m.role) && m.user_id !== e?.user_id).map(m => <Button key={m.user_id} label={snapshot.employees.find(e => e.user_id === m.user_id)?.name || `${m.role}: ${m.user_id.slice(0, 8)}`} secondary={manager !== m.user_id} onPress={() => setManager(m.user_id)} />)}</View>{!!error && <Text style={s.error}>{error}</Text>}<View style={s.row}><Button label="Save employee" disabled={busy} onPress={save} /><Button label="Cancel" disabled={busy} secondary onPress={onCancel} /></View></View>;
}
function LeaveForm({ employees, busy, onCancel, onSave }: SaveForm & { employees: CloudEmployee[] }) {
  const [employee, setEmployee] = useState(employees[0]?.id || ''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState('');
  function save() { try { weekdays(start, end); if (!employee || !reason.trim()) throw Error('Choose an employee and enter a reason.'); void onSave({ p_employee_id: employee, p_start: start, p_end: end, p_reason: reason }); } catch (err) { setError((err as Error).message); } }
  return <View style={s.form}><Text style={s.heading}>New leave request</Text><View style={s.row}>{employees.map(e => <Button key={e.id} label={e.name} secondary={employee !== e.id} onPress={() => setEmployee(e.id)} />)}</View><Field label="Start date (YYYY-MM-DD)" value={start} onChange={setStart} /><Field label="End date (YYYY-MM-DD)" value={end} onChange={setEnd} /><Field label="Reason" value={reason} onChange={setReason} />{!!error && <Text style={s.error}>{error}</Text>}<View style={s.row}><Button label="Submit request" disabled={busy} onPress={save} /><Button label="Cancel" disabled={busy} secondary onPress={onCancel} /></View></View>;
}
function MemberAccess({ member, name, protectedAccess, busy, onSave }: {
  member: Member;
  name?: string;
  protectedAccess: boolean;
  busy: boolean;
  onSave: (role: Member['role'] | null) => Promise<boolean>;
}) {
  const [choice, setChoice] = useState<Member['role'] | null | undefined>(undefined);
  const roles: Member['role'][] = ['employee', 'manager', 'hr'];
  return <View style={s.form}>
    <Text style={s.label}>{name}</Text>
    <Text style={s.small}>{member.role.toUpperCase()}{protectedAccess ? ' · Protected access' : ''}</Text>
    {!protectedAccess && choice === undefined && <View style={s.row}>
      {roles.filter(role => role !== member.role).map(role => <Button key={role} label={`Set ${role.toUpperCase()}`} disabled={busy} secondary onPress={() => setChoice(role)} />)}
      <Button label="Revoke access" disabled={busy} secondary onPress={() => setChoice(null)} />
    </View>}
    {!protectedAccess && choice !== undefined && <>
      <Text style={s.small}>{choice === null ? 'Revoke workspace access and unlink the employee record?' : `Change this member’s role to ${choice.toUpperCase()}?`}</Text>
      {member.role !== 'employee' && (choice === null || choice === 'employee') && <Text style={s.small}>This also clears their manager assignments.</Text>}
      <View style={s.row}>
        <Button label={choice === null ? 'Confirm revocation' : 'Save role'} disabled={busy} onPress={async () => { if (await onSave(choice)) setChoice(undefined); }} />
        <Button label="Cancel" disabled={busy} secondary onPress={() => setChoice(undefined)} />
      </View>
    </>}
  </View>;
}

function AccessForm({ employees, busy, onCancel, onSave }: SaveForm & { employees: CloudEmployee[] }) {
  const [email, setEmail] = useState(''), [role, setRole] = useState('employee'), [employee, setEmployee] = useState<string | null>(null);
  return <View style={s.form}><Field label="Work email" value={email} onChange={setEmail} /><Text style={s.label}>Role</Text><View style={s.row}>{['employee', 'manager', 'hr'].map(r => <Button key={r} label={r.toUpperCase()} secondary={role !== r} onPress={() => setRole(r)} />)}</View><Text style={s.label}>Link employee record (matching email required)</Text><View style={s.row}><Button label="No employee record" secondary={employee !== null} onPress={() => setEmployee(null)} />{employees.filter(e => !e.user_id).map(e => <Button key={e.id} label={e.name} secondary={employee !== e.id} onPress={() => { setEmployee(e.id); setEmail(e.email); }} />)}</View><Text style={s.small}>HR can manage all records and company access. Managers see their assigned reports. Employees see only their own record and leave.</Text><View style={s.row}><Button label="Grant access" disabled={busy || !email.trim()} onPress={() => void onSave({ p_email: email.trim(), p_role: role, p_employee_id: employee })} /><Button label="Cancel" disabled={busy} secondary onPress={onCancel} /></View></View>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F8F9F5' }, auth: { flexGrow: 1, justifyContent: 'center', alignSelf: 'center', width: '100%', maxWidth: 520, padding: 24, gap: 18 }, content: { padding: 22, gap: 18, maxWidth: 1000, width: '100%', alignSelf: 'center' }, logo: { fontSize: 34, fontWeight: '800', color: '#24352C', letterSpacing: -1.5 }, title: { fontSize: 27, fontWeight: '700', color: '#24352C' }, subtitle: { fontSize: 14, color: '#647267', lineHeight: 22 }, small: { fontSize: 12, color: '#647267', lineHeight: 19 }, heading: { fontSize: 18, color: '#24352C', fontWeight: '700' }, label: { fontSize: 13, color: '#24352C', fontWeight: '600' }, card: { padding: 20, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E1E7D9', borderRadius: 15, gap: 16 }, input: { borderWidth: 1, borderColor: '#CAD3C3', backgroundColor: '#FCFDF9', padding: 13, borderRadius: 9, minHeight: 48, color: '#24352C' }, button: { minHeight: 46, paddingHorizontal: 17, paddingVertical: 13, backgroundColor: '#ED631C', borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontWeight: '700', color: '#FFF', fontSize: 13 }, secondary: { backgroundColor: '#EAF2DA' }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }, listItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 17, borderBottomWidth: 1, borderColor: '#E8EDE1' }, form: { backgroundColor: '#F5F8EE', padding: 16, borderRadius: 12, gap: 14 }, error: { color: '#A83318', lineHeight: 21 }, message: { backgroundColor: '#EAF2DA', padding: 15, borderRadius: 9, color: '#24352C', lineHeight: 22 }, loading: { padding: 30, color: '#24352C' } });

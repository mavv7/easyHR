import React, { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Session } from '@supabase/supabase-js';
import { router, useLocalSearchParams } from 'expo-router';
import { configured, createPasswordRecoveryClient, supabase } from './client';
import { calendarDays, calendarMonth, companyDateKey, isDateKey, monthlyAgenda } from './leaveCalendar';
import { contractEndStatus } from './contractDates';
import { suggestZambiaDeductions } from './zambiaPayroll';
import { WorkflowWorkspace } from './WorkflowWorkspace';
import { WorkflowDocument } from './WorkflowDocument';
import { MonthPicker } from './MonthPicker';
import { CompanySettingsScreen } from './CompanySettings';
import { CompanySignup, EmployeeSignIn, PhoneVerification } from './CompanySignup';
import { zambianMobile } from './companyRegistration';
import { Audit, CloudEmployee, CloudLeave, Contract, emptySnapshot, loadAuditPage, loadCompanySettings, loadContracts, loadOrganizations, loadPayrollDrafts, loadPendingPhone, loadSnapshot, Member, Organization, PayPoint, PayrollDraft, rpc, Snapshot } from './api';
import { money, weekdays } from '../domain';
import { AuthCover, Brand, Button, colors, Field, Rings, s, WorkspaceNav } from './workspaceDesign';

function StatusPill({ label, tone = 'positive' }: { label: string; tone?: 'positive' | 'pending' | 'neutral' }) {
  return <View style={[s.badge, tone === 'pending' && s.badgePending, tone === 'neutral' && s.badgeNeutral]}>
    <Text style={[s.badgeText, tone === 'pending' && s.badgePendingText]}>{label}</Text>
  </View>;
}
export default function CloudApp({ onDemo }: { onDemo: () => void }) {
  const wide = useWindowDimensions().width >= 860;
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
    {loading ? <Text style={s.loading}>Opening your workspace…</Text> : session ? <CompanyWorkspace key={session.user.id} session={session} wide={wide} /> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.auth}>
      <View style={[s.authShell, wide && s.authWide]}>
        <AuthCover wide={wide} />
        <View style={[s.authForm, wide && s.authFormWide]}>
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          {configured ? <SignIn /> : <View style={s.card}><Text style={s.heading}>Connect your Supabase project</Text><Text style={s.subtitle}>Add your project URL and publishable key to mobile/.env.local, apply the database migration, then restart Expo. Setup steps are in docs/supabase-setup.md.</Text></View>}
          <View style={s.row}><Button label="Explore fictional demo" onPress={onDemo} secondary /></View>
        </View>
      </View>
    </ScrollView>}
  </KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>;
}
function SignIn() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [mode, setMode] = useState<'signin' | 'company' | 'member' | 'recovery'>('signin');
  async function authenticate() {
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 8) { setMessage('Enter a valid email and a password of at least 8 characters.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      setPassword('');
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  }
  if (mode === 'company') return <CompanySignup initialEmail={email} onBack={address => {
    setEmail(address); setMode('signin'); setPassword(''); setMessage('');
  }} />;
  if (mode === 'member') return <EmployeeSignIn initialEmail={email} onBack={address => {
    setEmail(address); setMode('signin'); setPassword(''); setMessage('');
  }} />;
  if (mode === 'recovery') return <PasswordRecovery initialEmail={email} onBack={(notice, address) => {
    setMode('signin');
    setEmail(address);
    setPassword('');
    setMessage(notice);
  }} />;

  return <View style={{ gap: 15 }}>
    <Text accessibilityRole="header" style={s.title}>Sign in</Text>
    <Field label="Work email" value={email} onChange={setEmail} inputMode="email" disabled={busy} />
    <Field label="Password" value={password} onChange={setPassword} secure disabled={busy} />
    {!!message && <Text accessibilityRole="alert" style={s.subtitle}>{message}</Text>}
    <Button label={busy ? 'Please wait…' : 'Sign in'} disabled={busy} onPress={() => void authenticate()} />
    <View style={s.row}>
      <Button label="Register a company" disabled={busy} onPress={() => { setMode('company'); setMessage(''); }} secondary />
      <Button label="Activate employee access" disabled={busy} onPress={() => { setMode('member'); setMessage(''); }} secondary />
      <Button label="Forgot password?" disabled={busy} onPress={() => setMode('recovery')} secondary />
    </View>
  </View>;
}

function PasswordRecovery({ initialEmail, onBack }: { initialEmail: string; onBack: (notice: string, address: string) => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [step, setStep] = useState<'request' | 'verify' | 'password'>('request');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const recovery = useRef<ReturnType<typeof createPasswordRecoveryClient> | null>(null);
  const working = useRef(false);

  async function submit() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (step === 'request') {
        const address = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
          setMessage('Enter a valid work email.');
          return;
        }
        const { error } = await supabase!.auth.resetPasswordForEmail(address);
        if (error && error.code !== 'user_not_found') {
          setMessage('Could not request a code. Try again in a minute.');
          return;
        }
        setEmail(address);
        setStep('verify');
        setMessage('If the address is registered, you’ll receive a password reset code.');
      } else if (step === 'verify') {
        const token = code.trim();
        if (!/^\d+$/.test(token)) {
          setMessage('Enter the code from your reset email.');
          return;
        }
        recovery.current ??= createPasswordRecoveryClient();
        const { data, error } = await recovery.current.auth.verifyOtp({ email, token, type: 'recovery' });
        if (error || !data.session) {
          setMessage('This code could not be verified. Check it or request a new code.');
          return;
        }
        setCode('');
        setStep('password');
      } else {
        if (password.length < 8 || password !== confirmation) {
          setMessage('Use at least 8 characters and enter the same password twice.');
          return;
        }
        const auth = recovery.current!.auth;
        const { error } = await auth.updateUser({ password });
        if (error) {
          setMessage(error.code === 'session_not_found' ? 'Your recovery session expired. Request a new code.' : error.message);
          return;
        }
        recovery.current = null;
        void auth.signOut({ scope: 'local' }).catch(() => {});
        onBack('Password updated. Sign in with your new password.', email);
      }
    } catch {
      setMessage('Could not complete password recovery. Try again.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  function clearRecovery() {
    const client = recovery.current;
    recovery.current = null;
    if (step === 'password') void client?.auth.signOut({ scope: 'local' }).catch(() => {});
    setCode('');
    setPassword('');
    setConfirmation('');
    setMessage('');
    setStep('request');
  }

  return <View style={s.card}>
    <Text style={s.heading}>Reset your password</Text>
    {step === 'request' && <Field label="Work email" value={email} onChange={setEmail} />}
    {step === 'verify' && <Field label="Email code" value={code} onChange={setCode} />}
    {step === 'password' && <>
      <Field label="New password" value={password} onChange={setPassword} secure />
      <Field label="Confirm new password" value={confirmation} onChange={setConfirmation} secure />
    </>}
    {!!message && <Text accessibilityRole="alert" style={s.subtitle}>{message}</Text>}
    <Button label={step === 'request' ? 'Send reset code' : step === 'verify' ? 'Verify code' : 'Save new password'} disabled={busy} onPress={() => void submit()} />
    {step !== 'request' && <Button label="Request a new code" disabled={busy} secondary onPress={clearRecovery} />}
    <Button label="Back to sign in" disabled={busy} secondary onPress={() => { clearRecovery(); onBack('', email); }} />
  </View>;
}

const leaveStatuses = ['All', 'Pending', 'Approved', 'Declined', 'Cancelled'] satisfies ('All' | CloudLeave['status'])[];

function CompanyWorkspace({ session, wide }: { session: Session; wide: boolean }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]), [org, setOrg] = useState(''), [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false), [fetching, setFetching] = useState(true), [message, setMessage] = useState('');
  const [editor, setEditor] = useState<CloudEmployee | 'new' | null>(null), [showLeave, setShowLeave] = useState(false), [search, setSearch] = useState('');
  const [showAccount, setShowAccount] = useState(false);
  const [pendingPhone, setPendingPhone] = useState<Awaited<ReturnType<typeof loadPendingPhone>>>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [peopleSort, setPeopleSort] = useState<'Name' | 'Department'>('Name');
  const [leaveStatus, setLeaveStatus] = useState<(typeof leaveStatuses)[number]>('All');
  const [leaveSearch, setLeaveSearch] = useState('');
  const [leaveEmployee, setLeaveEmployee] = useState<string | null>(null);
  const [approvalSearch, setApprovalSearch] = useState('');
  const [leaveFrom, setLeaveFrom] = useState('');
  const [leaveThrough, setLeaveThrough] = useState('');
  const generation = useRef(0), mounted = useRef(true), mutation = useRef(false);
  const workspaceScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const params = useLocalSearchParams<{ cloudtab?: string; workflow?: string; workflowMonth?: string }>();
  const membership = snapshot.members.find(m => m.user_id === session.user.id), isHR = membership?.role === 'hr';
  const tabs = ['Overview', 'People', 'Leave', 'Calendar', ...(isHR || membership?.role === 'manager' ? ['Approvals'] : []), ...(isHR ? ['Contracts', 'Payroll'] : []), 'Workflows', ...(isHR ? ['Activity', 'Workspace', 'Settings'] : [])];
  const tab = tabs.find(name => name === params.cloudtab) ?? 'Overview';
  useEffect(() => { workspaceScroll.current?.scrollTo({ y: 0, animated: false }); }, [tab, org, showAccount]);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setFetching(true);
    try {
      if (!org) {
        await rpc('hr_activate_workspace', {});
        const phone = await loadPendingPhone();
        if (mounted.current && ticket === generation.current) setPendingPhone(phone);
      }
      const list = await loadOrganizations();
      const selected = list.some(o => o.id === org) ? org : list[0]?.id || '';
      const data = selected ? await loadSnapshot(selected, session.user.id) : emptySnapshot;
      if (mounted.current && ticket === generation.current) { setOrganizations(list); setOrg(selected); setSnapshot(data); }
    } catch (err) { if (mounted.current && ticket === generation.current) { setSnapshot(emptySnapshot); setMessage((err as Error).message); } }
    finally { if (mounted.current && ticket === generation.current) setFetching(false); }
  }, [org, session.user.id]);
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
  const employeesById = new Map(snapshot.employees.map(employee => [employee.id, employee]));
  function matchesRequest(leave: CloudLeave, query: string) {
    return !query || [
      employeesById.get(leave.employee_id)?.name, leave.start_date, leave.end_date, leave.reason,
    ].some(value => value?.toLocaleLowerCase().includes(query));
  }
  function openTab(name: string) {
    setEditor(null);
    setShowLeave(false);
    router.setParams({ cloudtab: name, workflow: '', workflowMonth: '' });
  }
  function openWorkflow(section: string, month?: string) {
    setEditor(null);
    setShowLeave(false);
    router.setParams({ cloudtab: 'Workflows', workflow: section, workflowMonth: month ?? '' });
  }
  const userEmail = session.user.email?.toLowerCase();
  function canDecide(employee: CloudEmployee | undefined) {
    return !!employee && employee.user_id !== session.user.id && employee.email !== userEmail &&
      (isHR || (membership?.role === 'manager' && employee.manager_user_id === session.user.id));
  }
  const approvals = tabs.includes('Approvals')
    ? snapshot.leave.filter(leave => leave.status === 'Pending' && canDecide(employeesById.get(leave.employee_id)))
    : [];
  const approvalQuery = approvalSearch.trim().toLocaleLowerCase();
  const visibleApprovals = tab === 'Approvals'
    ? approvals.filter(leave => matchesRequest(leave, approvalQuery)).reverse()
    : [];
  const profile = profileId ? employeesById.get(profileId) : undefined;
  const peopleQuery = search.trim().toLocaleLowerCase();
  const departmentQuery = departmentFilter.trim().toLocaleLowerCase();
  const visiblePeople = tab === 'People' && !profile ? snapshot.employees.filter(employee =>
    employee.department.toLocaleLowerCase().includes(departmentQuery) &&
    [employee.name, employee.department, employee.job_title, employee.email, employee.staff_number].join(' ').toLocaleLowerCase().includes(peopleQuery),
  ).sort((a, b) => (peopleSort === 'Department' ? a.department.localeCompare(b.department) : 0) || a.name.localeCompare(b.name)) : [];
  const leaveQuery = leaveSearch.trim().toLocaleLowerCase();
  const from = leaveFrom.trim(), through = leaveThrough.trim();
  const validRange = (!from || isDateKey(from)) && (!through || isDateKey(through)) && (!from || !through || from <= through);
  const visibleLeave = tab === 'Leave' ? snapshot.leave.filter(leave => {
    if (leaveEmployee && leave.employee_id !== leaveEmployee) return false;
    if (leaveStatus !== 'All' && leave.status !== leaveStatus) return false;
    if (validRange && (leave.end_date < from || (through && leave.start_date > through))) return false;
    return matchesRequest(leave, leaveQuery);
  }) : [];
  const navigation = <WorkspaceNav tabs={org ? tabs : []} active={showAccount ? '' : tab} count={approvals.length} wide={wide} company={currentName}
    onSelect={name => { setShowAccount(false); if (name === 'People') setProfileId(null); openTab(name); }} />;
  if (pendingPhone) return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <Brand />
    <PhoneVerification key={pendingPhone.kind + pendingPhone.phone} initialPhone={pendingPhone.phone}
      employee={pendingPhone.kind === 'employee'} onVerified={async () => {
      await rpc('hr_activate_workspace', {});
      const remainingPhone = await loadPendingPhone();
      if (remainingPhone?.kind === pendingPhone.kind && remainingPhone.phone === pendingPhone.phone) {
        throw new Error('Your number is still awaiting confirmation. Refresh and try again.');
      }
      await refresh();
      setPendingPhone(remainingPhone);
    }} onSignOut={async () => {
      const { error } = await supabase!.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }} />
  </ScrollView>;
  return <View style={[s.frame, wide && s.desktop]}>
    {wide && navigation}
    <View style={s.page}>
    <View style={s.topbar}>
      <View style={[s.topbarInner, wide && s.topbarWide]}>
        {!wide && <Brand compact />}
        <View style={s.topbarIdentity}>
          <Text numberOfLines={1} style={s.label}>{currentName || 'easyHR workspace'}</Text>
          <Text numberOfLines={1} style={s.small}>{membership ? { hr: 'HR administrator', manager: 'Manager', employee: 'Employee' }[membership.role] : 'Company access'}</Text>
        </View>
        <View style={s.topbarActions}>
          {!showAccount && <Button label={fetching ? 'Refreshing…' : 'Refresh'} onPress={() => void refresh()} disabled={fetching || busy} secondary />}
          <Button label={showAccount ? 'Done' : 'Account'} onPress={() => setShowAccount(!showAccount)} disabled={busy} secondary selected={showAccount} />
        </View>
      </View>
    </View>
    <ScrollView ref={workspaceScroll} style={s.body} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, wide && s.contentWide]}>
    <View style={[s.hero, wide && s.heroWide]}>
      <Rings />
      <Text accessibilityRole="header" style={s.heroTitle}>{showAccount ? 'Account' : tab}</Text>
      <Text style={s.heroMeta}>{showAccount ? session.user.email : 'Zambia · ZMW'}</Text>
    </View>
    {!!message && <Text accessibilityRole="alert" style={s.message}>{message}</Text>}
    {showAccount && <><AccountSettings busy={busy}
      onPasswordChange={(currentPassword, password) => act(async () => {
        const { error } = await supabase!.auth.updateUser({ current_password: currentPassword, password });
        if (error) throw error;
      }, 'Password updated')}
      onEndOtherSessions={() => act(async () => {
        const { error } = await supabase!.auth.signOut({ scope: 'others' });
        if (error) throw error;
      }, 'Other sessions were signed out')} />
      <View style={s.row}><Button label="Sign out" disabled={busy} secondary onPress={() => void act(async () => {
        const { error } = await supabase!.auth.signOut({ scope: 'local' });
        if (error) throw error;
      }, 'Signed out')} /></View>
    </>}
    {!showAccount && !org && !fetching && <View style={s.card}><Text style={s.heading}>Waiting for company access</Text><Text style={s.subtitle}>Confirm your work email or ask your HR administrator to authorize access, then refresh.</Text></View>}
    {!showAccount && !!org && <>
      {organizations.length > 1 && <View style={s.row}>{organizations.map(o => <Button key={o.id} label={o.name} disabled={busy || fetching} secondary={org !== o.id} onPress={() => {
        if (org === o.id) return;
        generation.current++;
        setSnapshot(emptySnapshot);
        setEditor(null);
        setProfileId(null);
        setSearch('');
        setDepartmentFilter('');
        setShowLeave(false);
        setLeaveSearch('');
        setLeaveEmployee(null);
        setApprovalSearch('');
        setLeaveStatus('All');
        setLeaveFrom('');
        setLeaveThrough('');
        setOrg(o.id);
      }} />)}</View>}
      {tab === 'Overview' && <WorkspaceOverview key={org} org={org} snapshot={snapshot} approvalCount={approvals.length} canApprove={tabs.includes('Approvals')} isHR={!!isHR}
        openWorkflow={openWorkflow}
        userId={session.user.id} openTab={name => {
          if (name === 'People') setProfileId(null);
          if (name === 'Leave') setLeaveEmployee(null);
          openTab(name);
        }} openProfile={id => { setProfileId(id); openTab('People'); }} />}
      {tab === 'People' && <View style={s.card}>
        {profile ? <View style={s.row}>
          <Button label="Back to people" disabled={busy} secondary onPress={() => { setEditor(null); setProfileId(null); }} />
          {isHR && <Button label="Edit employee" disabled={busy} onPress={() => setEditor(profile)} />}
        </View> : <>
          <View style={s.row}><Text style={s.heading}>People · {snapshot.employees.length}</Text>{isHR && <Button label="Add employee" disabled={busy} onPress={() => setEditor('new')} />}</View>
          <Field label="Search people" value={search} onChange={setSearch} />
          {!!snapshot.employees.length && <Field label="Filter by department" value={departmentFilter} onChange={setDepartmentFilter} />}
          {snapshot.employees.length > 1 && <View style={s.row}>{(['Name', 'Department'] as const).map(sort => <Button key={sort} label={`Sort by ${sort.toLowerCase()}`}
            selected={peopleSort === sort} secondary={peopleSort !== sort} onPress={() => setPeopleSort(sort)} />)}</View>}
        </>}
        {editor && isHR && <EmployeeForm key={editor === 'new' ? 'new' : editor.id} org={org} employee={editor} snapshot={snapshot}
          busy={busy} onCancel={() => setEditor(null)} onSave={async values => {
            const ok = await act(async () => {
              try { await rpc('hr_save_employee_access', { p_organization_id: org, ...values }); }
              catch (err) {
                if (typeof err === 'object' && err && 'code' in err && err.code === 'PGRST202') {
                  throw new Error('Apply the employee onboarding migration in Supabase before saving employees.');
                }
                throw err;
              }
            }, editor === 'new' ? 'Employee added. Ask them to sign in with their work email to verify their mobile number.' : 'Employee saved');
            if (ok) setEditor(null);
          }} />}
        {profile && <EmployeeProfile employee={profile} employees={snapshot.employees} requests={snapshot.leave} payPoint={snapshot.payPoints.find(point => point.id === profile.pay_point_id)}
          onOpenProfile={id => { setEditor(null); setProfileId(id); }}
          onOpenLeave={() => {
            setLeaveEmployee(profile.id);
            setLeaveSearch('');
            setLeaveStatus('All');
            setLeaveFrom('');
            setLeaveThrough('');
            openTab('Leave');
          }} />}
        {visiblePeople.map(employee => <View key={employee.id} style={s.listItem}>
          <Pressable accessibilityRole="button" accessibilityLabel={`View ${employee.name}'s profile`}
            disabled={busy} onPress={() => { setEditor(null); setProfileId(employee.id); }} style={{ flex: 1, gap: 5 }}>
            <Text style={s.heading}>{employee.name}</Text>
            {!!employee.staff_number && <Text style={s.small}>{employee.staff_number}</Text>}
            <Text style={s.subtitle}>{employee.job_title} · {employee.department}</Text>
            <Text style={s.small}>{employee.email}</Text>
            <Text style={s.label}>View profile</Text>
          </Pressable>
          {isHR && <Button label="Edit" secondary disabled={busy} onPress={() => setEditor(employee)} />}
        </View>)}
        {!profile && !!snapshot.employees.length && !visiblePeople.length && <Text style={s.subtitle}>No employees match your search.</Text>}
        {!snapshot.employees.length && <Text style={s.subtitle}>{isHR ? 'Add your first employee to get started.' : 'No employee records are assigned to your account yet.'}</Text>}
      </View>}
      {(tab === 'Leave' || tab === 'Approvals') && <View style={s.card}>
        {tab === 'Leave' ? <>
        <Text style={s.heading}>Leave requests</Text><Text style={s.small}>Current policy: whole weekdays only. Public holidays and statutory accrual are not configured. Pending requests reserve available days.</Text><Button label="Request leave" disabled={busy || !eligible.length} onPress={() => setShowLeave(true)} />
        {showLeave && <LeaveForm employees={eligible} requests={snapshot.leave} busy={busy} onCancel={() => setShowLeave(false)} onSave={async values => {
          if (await act(() => rpc('hr_request_leave', values), 'Leave submitted')) {
            setShowLeave(false);
            setLeaveStatus('Pending');
            setLeaveSearch('');
            setLeaveEmployee(null);
            setLeaveFrom('');
            setLeaveThrough('');
          }
        }} />}
        {leaveEmployee && <View style={s.row}>
          <Text style={s.label}>{employeesById.get(leaveEmployee)?.name ?? 'Selected employee'}</Text>
          <Button label="Show all employees" secondary onPress={() => setLeaveEmployee(null)} />
        </View>}
        {!!snapshot.leave.length && <>
          <Field label="Search leave by name, date or reason" value={leaveSearch} onChange={setLeaveSearch} />
          <Field label="From date (YYYY-MM-DD)" value={leaveFrom} onChange={setLeaveFrom} />
          <Field label="Through date (YYYY-MM-DD)" value={leaveThrough} onChange={setLeaveThrough} />
          {!validRange && <Text accessibilityRole="alert" style={s.error}>Use valid dates in YYYY-MM-DD format, with the from date first.</Text>}
          {(!!leaveFrom || !!leaveThrough) && <Button label="Clear dates" secondary onPress={() => { setLeaveFrom(''); setLeaveThrough(''); }} />}
          <View style={s.row}>
            {leaveStatuses.map(status => <Button key={status} label={status} selected={status === leaveStatus} secondary={status !== leaveStatus} onPress={() => setLeaveStatus(status)} />)}
          </View>
        </>}
        {!visibleLeave.length && <Text style={s.subtitle}>{snapshot.leave.length ? 'No leave requests match these filters.' : 'No leave requests yet.'}</Text>}
        </> : <>
          <Text style={s.heading}>Leave approvals</Text>
          {!!approvals.length && <Field label="Search pending approvals" value={approvalSearch} onChange={setApprovalSearch} />}
          {!visibleApprovals.length && <Text style={s.subtitle}>{approvals.length ? 'No approvals match your search.' : 'No leave requests are waiting for your decision.'}</Text>}
        </>}
        {(tab === 'Approvals' ? visibleApprovals : visibleLeave).map(leave => {
          const employee = employeesById.get(leave.employee_id);
          const canCancel = tab === 'Leave' && (isHR || employee?.user_id === session.user.id);
          return <View key={leave.id} style={s.nestedCard}>
            <View style={s.cardHeader}><Text style={s.heading}>{employee?.name || 'Employee'}</Text>
              <StatusPill label={leave.status} tone={leave.status === 'Pending' ? 'pending' : leave.status === 'Approved' ? 'positive' : 'neutral'} />
            </View>
            <Text style={s.subtitle}>{leave.start_date} → {leave.end_date} · {leave.days} days</Text>
            <Text style={s.label}>{leave.reason}</Text>
            {leave.status === 'Pending' && canDecide(employee) && <View style={s.row}>
              <Button label="Approve" disabled={busy} onPress={() => void act(() => rpc('hr_decide_leave', { p_id: leave.id, p_approve: true }), 'Leave approved and balance updated')} />
              <Button label="Decline" disabled={busy} secondary onPress={() => void act(() => rpc('hr_decide_leave', { p_id: leave.id, p_approve: false }), 'Leave declined')} />
            </View>}
            {leave.status === 'Pending' && canCancel && <ConfirmedAction label="Cancel leave request" confirmLabel="Confirm cancellation" busy={busy}
              onConfirm={() => act(() => rpc('hr_cancel_leave', { p_id: leave.id }), 'Leave request cancelled')} />}
          </View>;
        })}
      </View>}
      {tab === 'Calendar' && <LeaveCalendar key={org} requests={snapshot.leave} employees={employeesById} />}
      {tab === 'Contracts' && isHR && <ContractsRegister key={org} org={org} employees={snapshot.employees} />}
      {tab === 'Payroll' && isHR && <PayrollRegister key={org} org={org} employees={snapshot.employees} payPoints={snapshot.payPoints}
        onReview={month => openWorkflow('Payroll review', month)} />}
      {tab === 'Workflows' && membership && <WorkflowWorkspace key={org} org={org} userId={session.user.id} membership={membership}
        snapshot={snapshot} initialSection={params.workflow} initialMonth={params.workflowMonth} />}
      {tab === 'Activity' && isHR && <ActivityHistory key={org} org={org} snapshot={snapshot} employees={employeesById} user={session.user} />}
      {tab === 'Settings' && isHR && <CompanySettingsScreen key={org} org={org} payPoints={snapshot.payPoints} onSaved={refresh} />}
      {tab === 'Workspace' && isHR && <View style={s.card}><Text style={s.heading}>Workspace access</Text>
        <Text style={s.subtitle}>Add employees in People. You can change roles here after employees verify their details.</Text>
        <View style={s.row}><Button label="Open People" secondary onPress={() => { setProfileId(null); openTab('People'); }} /></View>
        {snapshot.members.map(member => <MemberAccess
        key={`${org}:${member.user_id}:${member.role}`}
        member={member}
        name={snapshot.employees.find(e => e.user_id === member.user_id)?.name || (member.user_id === session.user.id ? session.user.email : member.user_id)}
        protectedAccess={member.user_id === session.user.id || member.user_id === organizations.find(o => o.id === org)?.owner_id}
        busy={busy}
        onSave={role => act(() => rpc('hr_manage_member', {
          p_organization_id: org, p_user_id: member.user_id, p_expected_role: member.role, p_role: role,
        }), role ? 'Workspace role updated' : 'Workspace access revoked')}
      />)}</View>}
      {tab === 'Workspace' && isHR && snapshot.invitations !== null && <View style={s.card}>
        <Text style={s.heading}>Pending authorizations</Text>
        {!snapshot.invitations.length && <Text style={s.small}>No pending authorizations.</Text>}
        {snapshot.invitations.map(invitation => <View key={JSON.stringify([org, invitation])} style={s.form}>
          <Text style={s.label}>{invitation.email}</Text>
          <Text style={s.small}>{invitation.role.toUpperCase()}</Text>
          <ConfirmedAction label="Withdraw authorization" confirmLabel="Confirm withdrawal" busy={busy}
            onConfirm={() => act(() => rpc('hr_cancel_invitation', {
              p_organization_id: org, p_email: invitation.email, p_expected_role: invitation.role, p_expected_employee_id: invitation.employee_id,
            }), 'Authorization withdrawn')} />
        </View>)}
      </View>}
    </>}
    </ScrollView>
    {!wide && !!org && navigation}
    </View>
  </View>;
}
type SaveForm = { busy: boolean; onCancel: () => void; onSave: (values: Record<string, unknown>) => Promise<void> };
function EmployeeForm({ org, employee, snapshot, busy, onCancel, onSave }: SaveForm & { org: string; employee: CloudEmployee | 'new'; snapshot: Snapshot }) {
  const e = employee === 'new' ? null : employee;
  const [name, setName] = useState(e?.name || ''), [job, setJob] = useState(e?.job_title || ''), [department, setDepartment] = useState(e?.department || ''), [email, setEmail] = useState(e?.email || ''), [balance, setBalance] = useState(String(e?.leave_balance || 0)), [manager, setManager] = useState<string | null>(e?.manager_user_id || null), [error, setError] = useState('');
  const [payPoint, setPayPoint] = useState(e?.pay_point_id ?? null);
  const [staffNumber, setStaffNumber] = useState('');
  const [phone, setPhone] = useState(e?.phone ?? '');
  const pending = snapshot.invitations?.some(invitation => invitation.employee_id === e?.id) ?? false;
  const [authorize, setAuthorize] = useState(!e);
  const [mode, setMode] = useState<'automatic' | 'manual' | 'legacy' | 'loading' | 'failed'>(e ? 'legacy' : 'loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (e) return;
    let active = true;
    void loadCompanySettings(org).then(settings => {
      if (active) setMode(settings.automatic ? 'automatic' : 'manual');
    }, err => {
      if (active) setMode(['PGRST205', '42P01'].includes(err.code) ? 'legacy' : 'failed');
    });
    return () => { active = false; };
  }, [org, e, attempt]);
  const staffDetails = e ? 'pay_point_id' in e : mode === 'manual' || mode === 'automatic';
  function save() {
    if (name.trim().length < 2 || !job.trim() || !department.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !/^\d+$/.test(balance) || Number(balance) > 366) { setError('Complete all fields. Leave balance must be a whole number from 0 to 366.'); return; }
    if (mode === 'manual' && !/^[A-Z0-9][A-Z0-9_/-]{0,63}$/i.test(staffNumber.trim())) {
      setError('Enter an employee number using letters, digits, dashes, underscores or slashes.');
      return;
    }
    const mobile = zambianMobile(phone);
    if ((!e || pending || authorize || phone.trim()) && !mobile) {
      setError('Enter a Zambian mobile number, such as 097 123 4567 or +260 97 123 4567.');
      return;
    }
    setError('');
    void onSave({
      p_id: e?.id || null, p_version: e?.version || null, p_name: name, p_job_title: job, p_department: department,
      p_email: email, p_leave_balance: Number(balance), p_manager_user_id: manager,
      p_phone: mobile, p_authorize: authorize, p_staff_number: staffNumber || null,
      p_pay_point_id: payPoint, p_update_staff_details: !!e && staffDetails,
    });
  }
  return <View style={s.form}>
    <Text style={s.heading}>{e ? 'Edit employee' : 'New employee'}</Text>
    <Field label="Full name" value={name} onChange={setName} />
    <Field label="Job title" value={job} onChange={setJob} />
    <Field label="Department" value={department} onChange={setDepartment} />
    <Field label="Work email" value={email} onChange={setEmail} inputMode="email" />
    {e?.user_id ? !!e.phone && <Text style={s.label}>Mobile number · {e.phone}</Text>
      : <Field label="Zambian mobile number" value={phone} onChange={setPhone} inputMode="tel" />}
    {!e && <Text style={s.small}>The employee will verify their work email and mobile number when they first sign in.</Text>}
    {!!e && !e.user_id && !pending && <Button label="Authorize employee sign in" secondary
      selected={authorize} onPress={() => setAuthorize(!authorize)} />}
    <Field label="Available leave days" value={balance} onChange={setBalance} />
    {mode === 'manual' && <Field label="Employee number" value={staffNumber} onChange={setStaffNumber} />}
    {mode === 'automatic' && <Text style={s.small}>An employee number will be assigned on save.</Text>}
    {!!e?.staff_number && <Text style={s.label}>Employee number · {e.staff_number}</Text>}
    {staffDetails && !!snapshot.payPoints.length && <>
      <Text style={s.label}>Pay point</Text>
      <View style={s.row}>
        <Button label="Unassigned" secondary selected={!payPoint} onPress={() => setPayPoint(null)} />
        {snapshot.payPoints.map(point => <Button key={point.id} label={point.name} secondary
          selected={payPoint === point.id} onPress={() => setPayPoint(point.id)} />)}
      </View>
    </>}
    <Text style={s.label}>Approving manager</Text>
    <View style={s.row}><Button label="No manager" secondary={manager !== null} onPress={() => setManager(null)} />
      {snapshot.members.filter(m => ['hr', 'manager'].includes(m.role) && m.user_id !== e?.user_id).map(m =>
        <Button key={m.user_id} label={snapshot.employees.find(e => e.user_id === m.user_id)?.name || `${m.role}: ${m.user_id.slice(0, 8)}`}
          secondary={manager !== m.user_id} onPress={() => setManager(m.user_id)} />)}
    </View>
    {mode === 'loading' && <Text style={s.small}>Loading employee numbering…</Text>}
    {mode === 'failed' && <Button label="Retry loading employee numbering" secondary onPress={() => { setMode('loading'); setAttempt(value => value + 1); }} />}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <View style={s.row}><Button label="Save employee" disabled={busy || mode === 'loading' || mode === 'failed'} onPress={save} />
      <Button label="Cancel" disabled={busy} secondary onPress={onCancel} /></View>
  </View>;
}
const activityLabels: Record<string, string> = {
  'organization.created': 'Company workspace created',
  'organization.profile_saved': 'Company profile saved',
  'organization.numbering_saved': 'Employee numbering policy saved',
  'organization.pay_point_added': 'Pay point added',
  'employee.created': 'Employee added',
  'employee.updated': 'Employee updated',
  'employee.account_linked': 'Employee account linked',
  'leave.requested': 'Leave requested',
  'leave.approved': 'Leave approved',
  'leave.declined': 'Leave declined',
  'leave.cancelled': 'Leave cancelled',
  'member.added.hr': 'HR access granted',
  'member.added.manager': 'Manager access granted',
  'member.added.employee': 'Employee access granted',
  'member.role_changed.hr': 'Role changed to HR',
  'member.role_changed.manager': 'Role changed to manager',
  'member.role_changed.employee': 'Role changed to employee',
  'member.revoked': 'Workspace access revoked',
  'invitation.cancelled': 'Pending authorization withdrawn',
  'invitation.employee_verification': 'Employee verification authorized',
  'contract.created': 'Contract recorded',
  'contract.updated': 'Contract updated',
  'contract.reviewed': 'Contract reviewed',
  'payroll.draft_saved': 'Payroll draft saved',
  'payroll.submit': 'Payroll submitted to Finance',
  'payroll.return': 'Payroll returned to HR',
  'payroll.approve': 'Payroll approved and payslips published',
  'payroll.compensation_scheduled': 'Compensation change scheduled',
  'payroll.finance_granted': 'Finance review access granted',
  'payroll.finance_revoked': 'Finance review access revoked',
  'payroll.overtime_imported': 'Approved overtime imported',
  'payroll.remittance_recorded': 'Statutory remittance recorded',
  'payroll.query_opened': 'Payroll query opened',
  'payroll.query_assigned': 'Payroll query assigned',
  'payroll.query_resolved': 'Payroll query resolved',
  'contract.document_uploaded': 'Contract PDF attached',
  'receipt.document_uploaded': 'Statutory receipt attached',
  'people.task_created': 'People task assigned',
  'people.task_completed': 'People task completed',
  'attendance.cutoff_set': 'Attendance cut-off set',
  'attendance.submitted': 'Timesheet submitted',
  'attendance.approved': 'Timesheet approved',
  'attendance.returned': 'Timesheet returned',
};

const activityCategories = [
  { label: 'All', prefixes: [] },
  { label: 'Employees', prefixes: ['employee.'] },
  { label: 'Leave', prefixes: ['leave.'] },
  { label: 'Access', prefixes: ['member.', 'invitation.'] },
  { label: 'Company', prefixes: ['organization.'] },
  { label: 'Contracts', prefixes: ['contract.'] },
  { label: 'Payroll', prefixes: ['payroll.'] },
];

function ActivityHistory({ org, snapshot, employees, user }: {
  org: string;
  snapshot: Snapshot;
  employees: Map<string, CloudEmployee>;
  user: Session['user'];
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(activityCategories[0]);
  const [history, setHistory] = useState<Audit[] | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState('');
  const loading = useRef(false);
  const loadedEvents = history ?? snapshot.audit;
  const query = search.trim().toLocaleLowerCase();
  const employeesByUser = new Map(snapshot.employees.map(employee => [employee.user_id, employee.name]));
  const leaveById = new Map(snapshot.leave.map(leave => [leave.id, leave]));
  function userName(userId: string) {
    return employeesByUser.get(userId) ?? (userId === user.id ? user.email : undefined);
  }
  function subject(event: Audit) {
    if (!event.record_id) return undefined;
    const kind = event.action.split('.')[0];
    if (kind === 'employee' || kind === 'invitation') return employees.get(event.record_id)?.name;
    if (kind === 'member') return userName(event.record_id);
    if (kind === 'leave') {
      const leave = leaveById.get(event.record_id);
      return leave && employees.get(leave.employee_id)?.name;
    }
  }
  const events = loadedEvents.map(event => ({
    event, label: activityLabels[event.action] ?? event.action, actor: userName(event.actor_id), subject: subject(event),
  })).filter(({ event, label, actor, subject }) =>
    (!category.prefixes.length || category.prefixes.some(prefix => event.action.startsWith(prefix))) &&
    [event.action, event.actor_id, event.record_id, label, actor, subject].some(value => value?.toLocaleLowerCase().includes(query)),
  );
  async function loadOlder() {
    const cursor = loadedEvents.at(-1);
    if (!cursor || loading.current) return;
    loading.current = true;
    setLoadingOlder(true);
    setOlderError('');
    try {
      const page = await loadAuditPage(org, cursor);
      // Keep the starting page fixed while browsing so the live refresh cannot create gaps.
      setHistory([...loadedEvents, ...page]);
      setAtEnd(page.length === 0);
    } catch {
      setOlderError('Could not load older activity. Try again.');
    } finally {
      loading.current = false;
      setLoadingOlder(false);
    }
  }
  return <View style={s.card}>
    <Text style={s.heading}>Activity history</Text>
    <Text style={s.small}>{loadedEvents.length} {loadedEvents.length === 1 ? 'event' : 'events'} loaded. Search and filters apply to loaded events.</Text>
    {history && <Button label="Back to latest" secondary disabled={loadingOlder} onPress={() => {
      setHistory(null);
      setAtEnd(false);
      setOlderError('');
    }} />}
    {!!loadedEvents.length && <>
      <Field label="Search activity" value={search} onChange={setSearch} />
      <View style={s.row}>{activityCategories.map(item => <Button key={item.label} label={item.label}
        selected={item === category} secondary={item !== category} onPress={() => setCategory(item)} />)}</View>
    </>}
    {!events.length && <Text style={s.subtitle}>{loadedEvents.length ? 'No loaded events match these filters.' : 'No activity recorded yet.'}</Text>}
    {events.map(({ event, label, actor, subject }) => <View key={event.id} style={s.listItem}>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.small}>{new Date(event.created_at).toLocaleString()}</Text>
        <Text selectable style={s.small}>Actor: {actor ? `${actor} · ${event.actor_id}` : event.actor_id}</Text>
        {!!event.record_id && <Text selectable style={s.small}>Record: {subject ? `${subject} · ${event.record_id}` : event.record_id}</Text>}
      </View>
    </View>)}
    {!!olderError && <Text accessibilityRole="alert" style={s.error}>{olderError}</Text>}
    {!!loadedEvents.length && (atEnd
      ? <Text style={s.small}>You’ve reached the oldest event.</Text>
      : <Button label={loadingOlder ? 'Loading older events…' : 'Load older events'} secondary disabled={loadingOlder} onPress={() => void loadOlder()} />)}
  </View>;
}

function RegisterEditor({ title, busy, children, onClose }: {
  title: string; busy: boolean; children: React.ReactNode; onClose: () => void;
}) {
  const wide = useWindowDimensions().width >= 860;
  const close = () => { if (!busy) onClose(); };
  return <Modal visible transparent animationType="none" onRequestClose={close}>
    <KeyboardAvoidingView style={s.drawerOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={[s.drawer, wide && s.drawerWide]} accessibilityViewIsModal>
        <View style={[s.drawerHeading, s.cardHeader]}>
          <Text accessibilityRole="header" style={s.heading}>{title}</Text>
          <Button label="Close" disabled={busy} secondary onPress={close} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.drawerContent}>{children}</ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

function RegisterFeedback({ message, tone }: { message: string; tone: 'error' | 'notice' | 'loading' }) {
  return <View style={[s.feedback, tone === 'error' && s.feedbackError]}>
    {tone === 'loading' && <ActivityIndicator size="small" color={colors.copper} />}
    <Text accessibilityRole={tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite"
      style={[tone === 'error' ? s.error : s.subtitle, { flex: 1 }]}>{message}</Text>
  </View>;
}

function useEditorFocus() {
  const trigger = useRef<HTMLElement | null>(null);
  function capture() {
    if (Platform.OS === 'web' && document.activeElement instanceof HTMLElement) trigger.current = document.activeElement;
  }
  function restore() {
    const element = trigger.current;
    trigger.current = null;
    if (element) setTimeout(() => { if (element.isConnected) element.focus(); }, 0);
  }
  return { capture, restore };
}

function useHrRegister<T>(load: () => Promise<T[]>) {
  const [records, setRecords] = useState<T[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const writing = useRef(false);
  useEffect(() => {
    let active = true;
    load().then(data => { if (active) setRecords(data); }).catch((err: { code?: string; message?: string }) => {
      if (active) {
        setRecords(null);
        const needsMigration = ['PGRST205', '42P01', '42703'].includes(err.code ?? '');
        setError(needsMigration ? 'This workspace needs the latest Contracts and Payroll database migrations.'
          : err.message || 'Could not load records.');
      }
    });
    return () => { active = false; };
  }, [load, revision]);
  function reload(keepRecords = false) {
    setError('');
    if (!keepRecords) setRecords(null);
    setRevision(value => value + 1);
  }
  async function save(work: () => Promise<unknown>, success: string) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await work(); reload(true); setNotice(success); return true; }
    catch (err) { setError((err as Error).message); return false; }
    finally { writing.current = false; setBusy(false); }
  }
  return { records, error, notice, busy, reload, save };
}

function ContractsRegister({ org, employees }: { org: string; employees: CloudEmployee[] }) {
  const load = useCallback(() => loadContracts(org), [org]);
  const [employer, setEmployer] = useState<Awaited<ReturnType<typeof loadCompanySettings>> | null>(null);
  useEffect(() => {
    let active = true;
    void loadCompanySettings(org).then(settings => {
      if (active) setEmployer(settings);
    }, () => {
      if (active) setEmployer(null);
    });
    return () => { active = false; };
  }, [org]);
  const { records, error, notice, busy, reload, save } = useHrRegister(load);
  const [editor, setEditor] = useState<Contract | 'new' | null>(null);
  const editorFocus = useEditorFocus();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const names = new Map(employees.map(employee => [employee.id, employee.name]));
  const today = companyDateKey();
  function openEditor(value: Contract | 'new') {
    editorFocus.capture();
    setEditor(value);
  }
  function closeEditor() {
    setEditor(null);
    editorFocus.restore();
  }
  const query = search.trim().toLocaleLowerCase();
  const contracts = (records ?? []).map(contract => ({ contract, endStatus: contractEndStatus(contract.end_date, today) }))
    .filter(({ contract, endStatus }) => {
      if (filter === 'Needs review' && contract.reviewed_at) return false;
      if (filter === 'Reviewed' && !contract.reviewed_at) return false;
      if ((filter === 'Ending soon' || filter === 'Expired') && endStatus !== filter) return false;
      return `${contract.title} ${names.get(contract.employee_id) ?? ''}`.toLocaleLowerCase().includes(query);
    }).sort((a, b) => b.contract.start_date.localeCompare(a.contract.start_date));
  return <View style={s.card}>
    <View style={s.cardHeader}>
      <Text accessibilityRole="header" style={s.heading}>Contract register</Text>
      {employer && <Text style={s.small}>{[
        employer.profile.legal_name || employer.hr_organizations.name,
        employer.profile.registration_number && `PACRA ${employer.profile.registration_number}`,
        employer.profile.address,
      ].filter(Boolean).join(' · ')}</Text>}
      <View style={s.row}>
        <Button label="Refresh" secondary disabled={busy} onPress={() => reload()} />
        <Button label="Add contract" disabled={busy || !records || !employees.length} onPress={() => openEditor('new')} />
      </View>
    </View>
    {!!error && !editor && <RegisterFeedback message={error} tone="error" />}
    {!!notice && <RegisterFeedback message={notice} tone="notice" />}
    {!records && !error && <RegisterFeedback message="Loading contracts…" tone="loading" />}
    {!!records?.length && <View style={s.toolbar}>
      <Field label="Search contract titles or employees" value={search} onChange={setSearch} />
      <View style={s.row}>{['All', 'Needs review', 'Reviewed', 'Ending soon', 'Expired'].map(option =>
        <Button key={option} label={option} secondary={filter !== option} selected={filter === option} onPress={() => setFilter(option)} />)}</View>
    </View>}
    {records && !contracts.length && <Text style={s.subtitle}>{records.length ? 'No contracts match these filters.' : 'No contracts recorded yet. Add a contract to start the register.'}</Text>}
    {editor && <RegisterEditor title={editor === 'new' ? 'New contract' : 'Edit contract'} busy={busy} onClose={closeEditor}>
      {!!error && <RegisterFeedback message={error} tone="error" />}
      <ContractForm key={editor === 'new' ? 'new' : editor.id} contract={editor === 'new' ? null : editor}
        employees={employees} busy={busy} onCancel={closeEditor} onSave={async values => {
          if (await save(() => rpc('hr_save_contract', { p_org: org, ...values }), 'Contract saved.')) closeEditor();
        }} />
    </RegisterEditor>}
    {contracts.map(({ contract, endStatus }) => <View key={contract.id} style={s.nestedCard}>
      <View style={s.cardHeader}><Text style={s.label}>{contract.title}</Text>
        <View style={s.row}>
          {!!endStatus && <StatusPill label={endStatus} tone={endStatus === 'Expired' ? 'neutral' : 'pending'} />}
          <StatusPill label={contract.reviewed_at ? 'Reviewed' : 'Needs review'} tone={contract.reviewed_at ? 'positive' : 'pending'} />
        </View>
      </View>
      <Text style={s.subtitle}>{names.get(contract.employee_id) ?? 'Employee'} · {contract.start_date}{contract.end_date ? ` to ${contract.end_date}` : ''}</Text>
      {contract.basic_minor !== null && <Text style={s.small}>{money(contract.basic_minor)} monthly basic pay</Text>}
      {!!contract.pay_terms && <Text style={s.small}>{contract.pay_terms}</Text>}
      <WorkflowDocument org={org} record={contract.id} kind="contract" canUpload onUploaded={() => reload()} />
      {contract.reviewed_at && <Text style={s.small}>Internally reviewed {new Date(contract.reviewed_at).toLocaleDateString()}</Text>}
      <View style={s.row}>
        <Button label="Edit" secondary disabled={busy} onPress={() => openEditor(contract)} />
        {!contract.reviewed_at && <Button label="Mark reviewed" disabled={busy} onPress={() => void save(() => rpc('hr_review_contract', { p_org: org, p_id: contract.id, p_version: contract.version }), 'Internal review recorded.')} />}
      </View>
    </View>)}
  </View>;
}

function ContractForm({ contract, employees, busy, onCancel, onSave }: SaveForm & { contract: Contract | null; employees: CloudEmployee[] }) {
  const [employee, setEmployee] = useState(contract?.employee_id ?? employees[0]?.id ?? '');
  const [title, setTitle] = useState(contract?.title ?? '');
  const [start, setStart] = useState(contract?.start_date ?? '');
  const [end, setEnd] = useState(contract?.end_date ?? '');
  const [basic, setBasic] = useState(contract?.basic_minor == null ? '' : (contract.basic_minor / 100).toFixed(2));
  const [payTerms, setPayTerms] = useState(contract?.pay_terms ?? '');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const name = title.trim(), from = start.trim(), through = end.trim();
  const length = Array.from(name).length;
  const validTitle = length >= 2 && length <= 120;
  const validStart = isDateKey(from);
  const validEnd = !through || (isDateKey(through) && (!validStart || through >= from));
  const basicMinor = parsePayrollAmount(basic);
  const validBasic = !basic.trim() || basicMinor !== null;
  const validPayTerms = Array.from(payTerms.trim()).length <= 2000;
  const matchingEmployees = employees.filter(entry => entry.name.toLocaleLowerCase().includes(employeeSearch.trim().toLocaleLowerCase()));
  function submit() {
    setSubmitted(true);
    if (!employee || !validTitle || !validStart || !validEnd || !validBasic || !validPayTerms) return;
    void onSave({ p_employee: employee, p_title: name, p_start: from, p_end: through || null,
      p_id: contract?.id ?? null, p_version: contract?.version ?? null, p_basic: basicMinor, p_pay_terms: payTerms.trim() || null });
  }
  return <View style={s.form}>
    {!contract && <>
      <Field label="Find an employee" value={employeeSearch} onChange={setEmployeeSearch} />
      <View style={s.row}>{matchingEmployees.map(entry => <Button key={entry.id} label={entry.name}
        selected={employee === entry.id} secondary={employee !== entry.id} disabled={busy} onPress={() => setEmployee(entry.id)} />)}</View>
      {!matchingEmployees.length && <Text style={s.small}>No employees match your search.</Text>}
      {submitted && !employee && <Text accessibilityRole="alert" style={s.error}>Choose an employee.</Text>}
    </>}
    <Field label="Contract title" value={title} onChange={setTitle} error={submitted && !validTitle ? 'Enter 2 to 120 characters.' : undefined} />
    <Field label="Start date (YYYY-MM-DD)" value={start} onChange={setStart} error={submitted && !validStart ? 'Enter a valid start date.' : undefined} />
    <Field label="End date (optional, YYYY-MM-DD)" value={end} onChange={setEnd} error={submitted && !validEnd ? 'Enter a valid date on or after the start date.' : undefined} />
    <Field label="Monthly basic pay (optional, ZMW)" value={basic} onChange={setBasic} inputMode="decimal" error={submitted && !validBasic ? payrollAmountError : undefined} />
    <Field label="Allowances, bonuses, benefits and payment terms" value={payTerms} onChange={setPayTerms} multiline disabled={busy} error={submitted && !validPayTerms ? 'Use up to 2,000 characters.' : undefined} />
    <Text style={s.small}>Record how wages and benefits are calculated and when wages are paid. PAYE, NAPSA and NHIMA apply where required by law.</Text>
    {contract?.reviewed_at && <Text style={s.small}>Saving changes returns the contract to internal review.</Text>}
    <View style={s.row}><Button label={busy ? 'Saving…' : 'Save contract'} disabled={busy} onPress={submit} /><Button label="Cancel" secondary disabled={busy} onPress={onCancel} /></View>
  </View>;
}

function PayrollRegister({ org, employees, payPoints, onReview }: { org: string; employees: CloudEmployee[]; payPoints: PayPoint[]; onReview: (month: string) => void }) {
  const [period, setPeriod] = useState(() => companyDateKey().slice(0, 7));
  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.heading}>Payroll drafts</Text>
    <Text style={s.small}>Enter monthly basic pay, taxable cash allowances and bonuses in ZMW. Review suggestions for standard employment before processing payroll.</Text>
    <View style={s.row}><Button label="Review this payroll month" secondary onPress={() => onReview(period)} /></View>
    <MonthPicker period={period} onChange={setPeriod} />
    <PayrollMonth key={period} org={org} period={period} employees={employees} payPoints={payPoints} />
  </View>;
}

function PayrollMonth({ org, period, employees, payPoints }: { org: string; period: string; employees: CloudEmployee[]; payPoints: PayPoint[] }) {
  const load = useCallback(() => loadPayrollDrafts(org, `${period}-01`), [org, period]);
  const { records, error, notice, busy, reload, save } = useHrRegister(load);
  const [selected, setSelected] = useState<{ employeeId: string; draft?: PayrollDraft } | null>(null);
  const editorFocus = useEditorFocus();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All employees');
  const [payPointFilter, setPayPointFilter] = useState<string | null | undefined>();
  const drafts = new Map(records?.map(draft => [draft.employee_id, draft]));
  const editor = employees.find(employee => employee.id === selected?.employeeId);
  function closeEditor() {
    setSelected(null);
    editorFocus.restore();
  }
  const group = employees.filter(employee => payPointFilter === undefined || (employee.pay_point_id ?? null) === payPointFilter);
  const groupedDrafts = group.flatMap(employee => drafts.get(employee.id) ?? []);
  const gross = groupedDrafts.reduce((total, draft) => total + draft.base_minor + draft.additional_minor, 0);
  const net = suggestZambiaDeductions(period, 0, 0) && groupedDrafts.reduce(
    (total, draft) => total + (suggestZambiaDeductions(period, draft.base_minor, draft.additional_minor)?.net ?? 0), 0);
  const month = new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const query = search.trim().toLocaleLowerCase();
  const visibleEmployees = group.filter(employee => {
    if (filter === 'Needs draft' && drafts.has(employee.id)) return false;
    if (filter === 'Entered' && !drafts.has(employee.id)) return false;
    return [employee.name, employee.department, employee.staff_number].join(' ').toLocaleLowerCase().includes(query);
  });
  return <>
    <View style={s.row}><Button label="Refresh drafts" secondary disabled={busy} onPress={() => reload()} /></View>
    {!!error && !editor && <RegisterFeedback message={error} tone="error" />}
    {!!notice && <RegisterFeedback message={notice} tone="notice" />}
    {!records && !error && <RegisterFeedback message="Loading payroll drafts…" tone="loading" />}
    {net === null && <Text style={s.small}>Deduction suggestions are available for 2026 payroll months.</Text>}
    {records && <View style={s.metrics}>
      <View style={s.metric}><Text style={s.label}>Draft gross total</Text><Text style={s.metricValue}>{money(gross)}</Text></View>
      {net !== null && <View style={s.metric}><Text style={s.label}>Estimated net total</Text><Text style={s.metricValue}>{money(net)}</Text></View>}
      <View style={s.metric}><Text style={s.label}>Employee drafts</Text><Text style={s.metricValue}>{groupedDrafts.length} / {group.length}</Text></View>
    </View>}
    {!!records && !!employees.length && <View style={s.toolbar}>
      <Field label="Search name, department or employee number" value={search} onChange={setSearch} />
      {!!payPoints.length && <>
        <Text style={s.label}>Pay point</Text>
        <View style={s.row}>
          <Button label="All pay points" secondary selected={payPointFilter === undefined} onPress={() => setPayPointFilter(undefined)} />
          <Button label="Unassigned" secondary selected={payPointFilter === null} onPress={() => setPayPointFilter(null)} />
          {payPoints.map(point => <Button key={point.id} label={point.name} secondary selected={payPointFilter === point.id}
            onPress={() => setPayPointFilter(point.id)} />)}
        </View>
      </>}
      <View style={s.row}>{['All employees', 'Needs draft', 'Entered'].map(option => <Button key={option} label={option}
        selected={filter === option} secondary={filter !== option} onPress={() => setFilter(option)} />)}</View>
    </View>}
    {records && !visibleEmployees.length && <Text style={s.subtitle}>{employees.length ? 'No employees match these filters.' : 'Add employees in People to prepare payroll drafts.'}</Text>}
    {editor && selected && <RegisterEditor title={selected.draft ? 'Edit payroll draft' : 'New payroll draft'} busy={busy} onClose={closeEditor}>
      <Text style={s.subtitle}>{month}</Text>
      {!!error && <RegisterFeedback message={error} tone="error" />}
      <PayrollForm key={editor.id} employee={editor} period={period} draft={selected.draft} busy={busy} onCancel={closeEditor}
      onSave={async values => {
        if (await save(() => rpc('hr_save_payroll_draft', { p_org: org, p_period: `${period}-01`, ...values }), 'Payroll draft saved.')) closeEditor();
      }} />
    </RegisterEditor>}
    {records && visibleEmployees.map(employee => {
      const draft = drafts.get(employee.id);
      const estimate = draft && suggestZambiaDeductions(period, draft.base_minor, draft.additional_minor);
      return <View key={employee.id} style={s.listItem}>
        <View style={{ flex: 1, gap: 4 }}><Text style={s.label}>{employee.name}</Text><Text style={s.small}>{employee.department}</Text>
          {draft ? <Text style={s.subtitle}>{money(draft.base_minor + draft.additional_minor)}</Text> : <StatusPill label="Draft needed" tone="pending" />}
          {estimate && <Text style={s.small}>{money(estimate.net)} estimated net</Text>}
        </View>
        <Button label={draft ? 'Edit draft' : 'Add draft'} secondary disabled={busy} onPress={() => {
          editorFocus.capture();
          setSelected({ employeeId: employee.id, draft });
        }} />
      </View>;
    })}
  </>;
}

function parsePayrollAmount(value: string) {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return minor <= 1_000_000_000 ? minor : null;
}

const payrollAmountError = 'Enter 0 to 10,000,000 ZMW with up to two decimal places.';

function PayrollForm({ employee, period, draft, busy, onCancel, onSave }: SaveForm & { employee: CloudEmployee; period: string; draft?: PayrollDraft }) {
  const [base, setBase] = useState(draft ? (draft.base_minor / 100).toFixed(2) : '');
  const overtime = draft?.overtime_minor ?? 0;
  const [allowances, setAllowances] = useState(draft ? ((draft.additional_minor - draft.bonus_minor - overtime) / 100).toFixed(2) : '0');
  const [bonus, setBonus] = useState(draft ? (draft.bonus_minor / 100).toFixed(2) : '0');
  const [submitted, setSubmitted] = useState(false);
  const baseMinor = parsePayrollAmount(base), allowanceMinor = parsePayrollAmount(allowances), bonusMinor = parsePayrollAmount(bonus);
  const additionalMinor = allowanceMinor === null || bonusMinor === null ? null : allowanceMinor + bonusMinor + overtime;
  const validAdditional = additionalMinor !== null && additionalMinor <= 1_000_000_000;
  const estimate = baseMinor !== null && validAdditional ? suggestZambiaDeductions(period, baseMinor, additionalMinor) : null;
  function submit() {
    setSubmitted(true);
    if (baseMinor === null || !validAdditional) return;
    void onSave({ p_employee: employee.id, p_base: baseMinor, p_additional: additionalMinor, p_bonus: bonusMinor, p_version: draft?.version ?? null });
  }
  return <View style={s.form}>
    <Text style={s.heading}>{employee.name}</Text>
    <Field label="Basic pay (ZMW)" value={base} onChange={setBase} inputMode="decimal" error={submitted && baseMinor === null ? payrollAmountError : undefined} />
    <Field label="Total taxable cash allowances (ZMW)" value={allowances} onChange={setAllowances} inputMode="decimal" error={submitted && allowanceMinor === null ? payrollAmountError : undefined} />
    <Field label="Total taxable bonuses (ZMW)" value={bonus} onChange={setBonus} inputMode="decimal" error={submitted && bonusMinor === null ? payrollAmountError : undefined} />
    {overtime > 0 && <Text style={s.small}>Approved overtime · {money(overtime)}</Text>}
    {submitted && additionalMinor !== null && !validAdditional && <Text accessibilityRole="alert" style={s.error}>Allowances, bonuses and overtime may total up to 10,000,000 ZMW.</Text>}
    {baseMinor !== null && validAdditional && <Text style={s.label}>{money(baseMinor + additionalMinor)} draft gross pay</Text>}
    {estimate && <View style={s.nestedCard}>
      <Text style={s.label}>Suggested statutory deductions</Text>
      <Text style={s.small}>ZRA PAYE · {money(estimate.paye)}</Text>
      <Text style={s.small}>Employee NAPSA · {money(estimate.napsa)}</Text>
      <Text style={s.small}>Employee NHIMA · {money(estimate.nhima)}</Text>
      <Text style={s.small}>Total deductions · {money(estimate.deductions)}</Text>
      <Text style={s.label}>Estimated net pay · {money(estimate.net)}</Text>
      <Text style={s.small}>Employer NAPSA · {money(estimate.napsa)} · Employer NHIMA · {money(estimate.nhima)}</Text>
      <Text style={s.small}>Review any exemptions, cumulative PAYE or secondary employment separately.</Text>
    </View>}
    <View style={s.row}><Button label={busy ? 'Saving…' : 'Save draft'} disabled={busy} onPress={submit} /><Button label="Cancel" secondary disabled={busy} onPress={onCancel} /></View>
  </View>;
}

function WorkspaceOverview({ org, snapshot, approvalCount, canApprove, isHR, userId, openTab, openProfile, openWorkflow }: {
  org: string;
  snapshot: Snapshot;
  approvalCount: number;
  canApprove: boolean;
  isHR: boolean;
  userId: string;
  openTab: (tab: string) => void;
  openProfile: (id: string) => void;
  openWorkflow: (section: string, month?: string) => void;
}) {
  const [alerts, setAlerts] = useState<{ tasks: number; renewals: number; review_period: string | null } | null>(null);
  useEffect(() => {
    if (!org) return;
    let active = true;
    void rpc('hr_workflow_alerts', { p_org: org }).then(data => {
      if (active) setAlerts(data);
    }, () => {
      if (active) setAlerts(null);
    });
    return () => { active = false; };
  }, [org]);
  const employee = snapshot.employees.find(entry => entry.user_id === userId);
  const reserved = employee ? snapshot.leave.reduce((days, request) =>
    request.employee_id === employee.id && request.status === 'Pending' ? days + request.days : days, 0) : 0;
  return <View style={s.card}>
    <Text style={s.heading}>Workspace overview</Text>
    <View style={s.metrics}>
      {canApprove && <View style={s.metric}>
        <Text style={s.label}>Awaiting your decision</Text>
        <Text style={s.metricValue}>{approvalCount}</Text>
        <View style={s.row}><Button label="Open approvals" secondary onPress={() => openTab('Approvals')} /></View>
      </View>}
      {employee && <View style={s.metric}>
        <Text style={s.label}>Leave days available</Text>
        <Text style={s.metricValue}>{Math.max(0, employee.leave_balance - reserved)}</Text>
        <Text style={s.small}>{reserved} reserved</Text>
        <View style={s.row}><Button label="Open your profile" secondary onPress={() => openProfile(employee.id)} /></View>
      </View>}
    </View>
    {alerts && (alerts.tasks > 0 || alerts.renewals > 0 || alerts.review_period) && <View style={s.nestedCard}>
      <Text style={s.label}>Workflow alerts</Text>
      {!!alerts.tasks && <Text style={s.small}>{alerts.tasks} open people tasks due within 14 days or overdue</Text>}
      {!!alerts.renewals && <Text style={s.small}>{alerts.renewals} contracts ending within 60 days</Text>}
      <View style={s.row}>
        {(alerts.tasks > 0 || alerts.renewals > 0) && <Button label="Open people tasks" secondary onPress={() => openWorkflow('People tasks')} />}
        {alerts.review_period && <Button label="Open payroll awaiting review" secondary
          onPress={() => openWorkflow('Payroll review', alerts.review_period?.slice(0, 7))} />}
      </View>
    </View>}
    <View style={s.row}>
      {isHR && <Button label="Open payroll drafts" onPress={() => openTab('Payroll')} />}
      {employee && <Button label="My payslips and contracts" secondary onPress={() => openWorkflow('My records')} />}
      {employee && <Button label="My timesheet" secondary onPress={() => openWorkflow('Attendance')} />}
      <Button label="People directory" secondary onPress={() => openTab('People')} />
      <Button label="Leave requests" secondary onPress={() => openTab('Leave')} />
      <Button label="Leave calendar" secondary onPress={() => openTab('Calendar')} />
    </View>
  </View>;
}

function EmployeeProfile({ employee, employees, requests, payPoint, onOpenProfile, onOpenLeave }: {
  employee: CloudEmployee;
  employees: CloudEmployee[];
  requests: CloudLeave[];
  payPoint?: PayPoint;
  onOpenProfile: (id: string) => void;
  onOpenLeave: () => void;
}) {
  const manager = employees.find(entry => entry.user_id && entry.user_id === employee.manager_user_id);
  const directReports = employee.user_id ? employees.filter(entry => entry.id !== employee.id && entry.manager_user_id === employee.user_id) : [];
  const employeeRequests = requests.filter(request => request.employee_id === employee.id);
  const reserved = employeeRequests.reduce((total, request) => request.status === 'Pending' ? total + request.days : total, 0);
  return <>
    <View style={s.form}>
      <Text style={s.heading}>{employee.name}</Text>
      <Text style={s.subtitle}>{employee.job_title} · {employee.department}</Text>
      <Text selectable style={s.label}>{employee.email}</Text>
      {!!employee.phone && <Text selectable style={s.label}>{employee.phone}</Text>}
      {!!employee.staff_number && <Text selectable style={s.label}>Employee number · {employee.staff_number}</Text>}
      {!!payPoint && <Text style={s.small}>Pay point · {payPoint.name}</Text>}
      <Text style={s.small}>{employee.user_id ? 'Account linked' : 'Account not linked'}</Text>
      <Text style={s.label}>Approving manager</Text>
      <Text style={s.subtitle}>{manager?.name ?? (employee.manager_user_id ? 'Manager assigned' : 'No manager assigned')}</Text>
    </View>
    {!!directReports.length && <View style={s.form}>
      <Text style={s.heading}>Direct reports</Text>
      <View style={s.row}>{directReports.map(report => <Button key={report.id} label={report.name} secondary onPress={() => onOpenProfile(report.id)} />)}</View>
    </View>}
    <View style={s.form}>
      <Text style={s.heading}>Leave balance</Text>
      <Text style={s.subtitle}>{employee.leave_balance} days in balance · {reserved} reserved</Text>
      <Text style={s.label}>{Math.max(0, employee.leave_balance - reserved)} days available to request</Text>
    </View>
    <View style={s.row}>
      <Text style={s.heading}>Recent leave requests</Text>
      {!!employeeRequests.length && <Button label="View all leave" secondary onPress={onOpenLeave} />}
    </View>
    {!employeeRequests.length && <Text style={s.subtitle}>No leave requests yet.</Text>}
    {employeeRequests.slice(0, 5).map(request => <View key={request.id} style={s.listItem}>
      <View>
        <Text style={s.label}>{request.status} · {request.days} {request.days === 1 ? 'day' : 'days'}</Text>
        <Text style={s.small}>{request.start_date} to {request.end_date}</Text>
      </View>
    </View>)}
  </>;
}

function LeaveForm({ employees, requests, busy, onCancel, onSave }: SaveForm & { employees: CloudEmployee[]; requests: CloudLeave[] }) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || '');
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [reason, setReason] = useState(''), [submitted, setSubmitted] = useState(false);
  const employee = employees.find(entry => entry.id === employeeId);
  const startDate = start.trim(), endDate = end.trim(), explanation = reason.trim();
  const validReason = explanation.length > 0 && Array.from(explanation).length <= 1000;
  const ownRequests = requests.filter(request => request.employee_id === employeeId);
  const reserved = ownRequests.reduce((total, request) => request.status === 'Pending' ? total + request.days : total, 0);
  const available = Math.max(0, (employee?.leave_balance ?? 0) - reserved);
  let days: number | undefined;
  let dateError = '';
  if (startDate && endDate) {
    try { days = weekdays(startDate, endDate); }
    catch (error) { dateError = (error as Error).message; }
  } else if (submitted) {
    dateError = 'Enter a start and end date.';
  }
  const overlaps = days !== undefined && ownRequests.some(request =>
    (request.status === 'Pending' || request.status === 'Approved') &&
    request.start_date <= endDate && request.end_date >= startDate,
  );
  const formError = dateError || (submitted && (!employee || !validReason)
    ? 'Choose an employee and enter a reason of up to 1,000 characters.' : '');

  function save() {
    setSubmitted(true);
    if (!employee || days === undefined || !validReason) return;
    void onSave({ p_employee_id: employee.id, p_start: startDate, p_end: endDate, p_reason: explanation });
  }

  return <View style={s.form}>
    <Text style={s.heading}>New leave request</Text>
    <View style={s.row}>{employees.map(entry => <Button key={entry.id} label={entry.name} selected={employeeId === entry.id} secondary={employeeId !== entry.id} onPress={() => setEmployeeId(entry.id)} />)}</View>
    <Field label="Start date (YYYY-MM-DD)" value={start} onChange={setStart} />
    <Field label="End date (YYYY-MM-DD)" value={end} onChange={setEnd} />
    {employee && <Text style={s.small}>{available} available · {reserved} reserved by pending requests</Text>}
    {days !== undefined && <Text style={s.label}>{days} working {days === 1 ? 'day' : 'days'} requested</Text>}
    {overlaps && <Text style={s.error}>These dates overlap a pending or approved request.</Text>}
    {employee && days !== undefined && days > available && <Text style={s.error}>This request exceeds the available balance shown.</Text>}
    <Field label="Reason" value={reason} onChange={setReason} />
    {!!formError && <Text accessibilityRole="alert" style={s.error}>{formError}</Text>}
    <View style={s.row}><Button label="Submit request" disabled={busy} onPress={save} /><Button label="Cancel" disabled={busy} secondary onPress={onCancel} /></View>
  </View>;
}
function AccountSettings({ busy, onPasswordChange, onEndOtherSessions }: {
  busy: boolean;
  onPasswordChange: (currentPassword: string, password: string) => Promise<boolean>;
  onEndOtherSessions: () => Promise<boolean>;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');

  async function savePassword() {
    if (!currentPassword || password.length < 8 || password !== confirmation) {
      setMessage('Enter your current password and enter the same new password twice. Use at least 8 characters.');
      return;
    }
    setMessage('');
    if (await onPasswordChange(currentPassword, password)) {
      setCurrentPassword('');
      setPassword('');
      setConfirmation('');
    }
  }

  return <>
    <View style={s.card}>
      <Text style={s.heading}>Change password</Text>
      <Field label="Current password" value={currentPassword} onChange={setCurrentPassword} secure />
      <Field label="New password" value={password} onChange={setPassword} secure />
      <Field label="Confirm new password" value={confirmation} onChange={setConfirmation} secure />
      {!!message && <Text accessibilityRole="alert" style={s.error}>{message}</Text>}
      <Button label="Save password" disabled={busy} onPress={() => void savePassword()} />
    </View>
    <View style={s.card}>
      <Text style={s.heading}>Other sessions</Text>
      <ConfirmedAction label="Sign out other sessions" confirmLabel="Confirm sign out" busy={busy} onConfirm={onEndOtherSessions} />
    </View>
  </>;
}

function LeaveCalendar({ requests, employees }: { requests: CloudLeave[]; employees: Map<string, CloudEmployee> }) {
  const today = companyDateKey();
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<'Day' | 'Month'>('Day');
  const [status, setStatus] = useState<'All' | 'Pending' | 'Approved'>('All');
  const month = selected.slice(0, 7);
  const days = calendarDays(month, status === 'All' ? requests : requests.filter(request => request.status === status));
  const selectedRequests = view === 'Month' ? monthlyAgenda(days) : days.find(day => day?.date === selected)?.requests ?? [];
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dateLabel = new Date(`${selected}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  return <View style={s.card}>
    <Text style={s.heading}>{monthLabel}</Text>
    <View style={s.row}>
      <Button label="Previous month" secondary onPress={() => setSelected(`${calendarMonth(month, -1)}-01`)} />
      <Button label="Today" secondary onPress={() => setSelected(today)} />
      <Button label="Next month" secondary onPress={() => setSelected(`${calendarMonth(month, 1)}-01`)} />
    </View>
    <View style={s.row}>
      {(['Day', 'Month'] as const).map(option => <Button key={option} label={option === 'Month' ? 'Month agenda' : 'Day view'}
        selected={view === option} secondary={view !== option} onPress={() => setView(option)} />)}
    </View>
    <View style={s.row}>{(['All', 'Pending', 'Approved'] as const).map(option => <Button key={option}
      label={option === 'All' ? 'All scheduled leave' : option} selected={status === option}
      secondary={status !== option} onPress={() => setStatus(option)} />)}</View>
    {view === 'Day' && <>
    <View style={calendarStyles.week}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => <Text key={label} style={calendarStyles.weekday}>{label}</Text>)}
    </View>
    {Array.from({ length: days.length / 7 }, (_, week) => <View key={week} style={calendarStyles.week}>
      {days.slice(week * 7, week * 7 + 7).map((day, index) => day
        ? <Pressable key={day.date} accessibilityRole="button" accessibilityState={{ selected: day.date === selected }}
            accessibilityLabel={`${day.date}, ${day.requests.length} leave requests`} onPress={() => setSelected(day.date)}
            style={[calendarStyles.day, day.date === selected && calendarStyles.selected]}>
            <Text style={s.label}>{Number(day.date.slice(-2))}</Text>
            {!!day.requests.length && <Text style={calendarStyles.count}>{day.requests.length}</Text>}
          </Pressable>
        : <View key={index} style={calendarStyles.day} />)}
    </View>)}
    </>}
    <Text style={s.heading}>{view === 'Month' ? 'Monthly agenda' : dateLabel}</Text>
    {!selectedRequests.length && <Text style={s.subtitle}>No {status === 'All' ? 'pending or approved' : status.toLowerCase()} leave {view === 'Month' ? 'this month' : 'on this date'}.</Text>}
    {selectedRequests.map(request => <View key={request.id} style={s.listItem}>
      <View>
        <Text style={s.label}>{employees.get(request.employee_id)?.name ?? 'Employee'}</Text>
        <Text style={s.small}>{request.status} · {request.start_date} to {request.end_date}</Text>
      </View>
    </View>)}
  </View>;
}

const calendarStyles = StyleSheet.create({
  week: { flexDirection: 'row', gap: 2 },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: colors.muted },
  day: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  selected: { backgroundColor: colors.limeLight, borderWidth: 1, borderColor: colors.copper },
  count: { fontSize: 11, fontWeight: '700', color: colors.copper },
});

function ConfirmedAction({ label, confirmLabel, busy, onConfirm }: {
  label: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? <View style={s.row}>
    <Button label={confirmLabel} disabled={busy} onPress={async () => { if (await onConfirm()) setConfirming(false); }} />
    <Button label="Keep" disabled={busy} secondary onPress={() => setConfirming(false)} />
  </View> : <Button label={label} disabled={busy} secondary onPress={() => setConfirming(true)} />;
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

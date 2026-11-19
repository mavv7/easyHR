import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../typography';
import { money } from '../domain';
import { rpc, type Member, type Snapshot } from './api';
import { companyDateKey, isDateKey } from './leaveCalendar';
import { Button, Field, s } from './workspaceDesign';
import { suggestZambiaDeductions } from './zambiaPayroll';
import { WorkflowDocument } from './WorkflowDocument';
import { MonthPicker, monthName } from './MonthPicker';

type Pay = {
  employee_id: string; name: string; basic: number | null; additional: number | null; bonus: number | null; overtime: number | null;
  version: number | null; previous_gross: number | null; previous_basic: number | null;
  previous_allowance: number | null; previous_bonus: number | null;
  scheduled: { effective_on: string; basic_minor: number; allowance_minor: number; reason: string } | null;
};
type Run = { id: string; submitted_by: string; status: 'submitted' | 'returned' | 'approved'; comment: string | null; version: number };
type Workbench = { rows: Pay[]; run: Run | null; finance: boolean; reviewers: string[] };
type Timesheet = { id: string; employee_id: string; name: string; submitted_by: string; regular_minutes: number; overtime_minutes: number; overtime_minor: number; status: string; version: number; reviewed_at: string | null };
type WorkTask = { id: string; employee_id: string; name: string; owner_id: string | null; category: string; title: string; due_on: string; result: string | null; completed_at: string | null };
type Renewal = { id: string; employee_id: string; name: string; title: string; end_date: string; manager_user_id: string | null };
type Payslip = { run_id: string; period: string; base_minor: number; gross_minor: number; bonus_minor: number; paye: number; napsa: number; nhima: number };
type Contract = { id: string; title: string; start_date: string; end_date: string | null; basic_minor: number | null; pay_terms: string | null };
type Query = { id: string; name: string; question: string; owner_id: string | null; reply: string | null; resolved_at: string | null };
const agencies = ['PAYE', 'NAPSA', 'NHIMA'] as const;
type Agency = typeof agencies[number];
type Remittance = { id: string; agency: Agency; paid_minor: number; paid_on: string; reference: string };
type Operations = {
  cutoff: string | null; payroll_locked: boolean;
  employee: string | null; finance: boolean; leave_balance: number | null; overtime: { employee_id: string; amount: number; imported: number | null }[];
  timesheets: Timesheet[]; expected_timesheets: string[]; tasks: WorkTask[]; renewals: Renewal[];
  contracts: Contract[]; payslips: Payslip[]; queries: Query[];
  reconciliation: { run_id: string; paye: number; napsa: number; nhima: number; payments: Remittance[] } | null;
};
type Action = (name: string, values: Record<string, unknown>) => Promise<void>;
type Choice = { label: string; value: string };
type Input = { key: string; label: string; initial?: string; choices?: Choice[]; pick?: boolean; multiline?: boolean; inputMode?: 'decimal' | 'numeric' };
type Editor = { title: string; inputs: Input[]; save: (values: Record<string, string>) => Promise<void> };

const options = (values: readonly string[]) => values.map(value => ({ label: value, value }));
const amount = (value: string) => {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a ZMW amount with up to two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (minor > 1_000_000_000) throw new Error('Enter a ZMW amount up to 10,000,000.');
  return minor;
};
const minutes = (value: string) => {
  if (!/^\d{1,5}$/.test(value.trim())) throw new Error('Enter whole minutes.');
  return Number(value);
};
const date = (value: string) => {
  if (!isDateKey(value)) throw new Error('Enter a valid date in YYYY-MM-DD format.');
  return value;
};
const month = (value: string) => date(value + '-01');
const required = (value: string) => {
  if (!value.trim()) throw new Error('Complete all required fields.');
  return value.trim();
};
const initialAmount = (minor: number) => (minor / 100).toFixed(2);
const message = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The request could not be completed.';
};

function WorkflowForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(editor.inputs.map(input => [
    input.key, input.initial ?? (input.pick ? '' : input.choices?.[0]?.value ?? ''),
  ])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  function change(key: string, value: string) { setValues(existing => ({ ...existing, [key]: value })); }
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setError('');
    setBusy(true);
    try { await editor.save(values); onClose(); }
    catch (error) { setError(message(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <View style={s.nestedCard}>
    <Text style={s.heading}>{editor.title}</Text>
    {editor.inputs.map(input => input.choices ? <WorkflowChoice key={input.key} label={input.label} choices={input.choices}
      value={values[input.key]} disabled={busy} onChange={value => change(input.key, value)} />
      : <Field key={input.key} label={input.label} value={values[input.key]} onChange={value => change(input.key, value)}
        disabled={busy} multiline={input.multiline} inputMode={input.inputMode} />)}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <View style={s.row}><Button label={busy ? 'Saving' : 'Confirm'} disabled={busy} onPress={() => void save()} />
      <Button label="Cancel" secondary disabled={busy} onPress={onClose} /></View>
  </View>;
}

function WorkflowChoice({ label, choices, value, disabled, onChange }: {
  label: string; choices: Choice[]; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const searchable = choices.length > 8;
  const selected = choices.find(choice => choice.value === value);
  const matches = choices.filter(choice => choice.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <View style={s.form}>
    <Text style={s.label}>{label}</Text>
    {searchable && <View style={s.row}><Text style={s.subtitle}>{selected?.label ?? 'Choose an option'}</Text>
      <Button label={expanded ? 'Close choices' : 'Change selection'} secondary disabled={disabled} onPress={() => { setSearch(''); setExpanded(!expanded); }} />
    </View>}
    {(!searchable || expanded) && <>
      {searchable && <Field label={`Search ${label.toLocaleLowerCase()}`} value={search} onChange={setSearch} disabled={disabled} />}
      <View style={s.row}>{matches.slice(0, 8).map(choice => <Button key={choice.value} label={choice.label}
        disabled={disabled} selected={value === choice.value} secondary onPress={() => { onChange(choice.value); setExpanded(false); }} />)}</View>
      {matches.length > 8 && <Text style={s.small}>Search to see more matches.</Text>}
      {!matches.length && <Text style={s.small}>No matching options.</Text>}
    </>}
  </View>;
}

export function WorkflowWorkspace({ org, userId, membership, snapshot, initialSection, initialMonth }: {
  org: string; userId: string; membership: Member; snapshot: Snapshot; initialSection?: string; initialMonth?: string;
}) {
  const [period, setPeriod] = useState(() => initialMonth && isDateKey(initialMonth + '-01')
    ? initialMonth : companyDateKey().slice(0, 7));
  const [section, setSection] = useState(initialSection ?? 'My records');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{ period: string; operations: Operations; payroll: Workbench | null } | null>(null);
  const [updated, setUpdated] = useState(false);
  const isHR = membership.role === 'hr';
  const current = data?.period === period ? data : null;
  const operations = current?.operations;
  const payroll = current?.payroll;
  const finance = operations?.finance ?? false;
  const sections = ['My records', 'Attendance', 'People tasks', ...(isHR || finance ? ['Payroll review', 'Reconciliation'] : [])];
  const active = sections.includes(section) ? section : sections[0];
  const employeeChoices = snapshot.employees.map(employee => ({ value: employee.id, label: employee.name }));
  const memberChoices = snapshot.members.map(member => ({
    value: member.user_id,
    label: member.user_id === userId ? 'Me' : snapshot.employees.find(e => e.user_id === member.user_id)?.name ?? member.user_id,
  }));
  const call: Action = useCallback(async (name, values) => {
    setBusy(true);
    try {
      await rpc(name, { p_org: org, ...values });
      setUpdated(true);
      setRevision(value => value + 1);
    } finally { setBusy(false); }
  }, [org]);
  const periodDate = period + '-01';
  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const operations: Operations = await rpc('hr_operations', { p_org: org, p_period: periodDate });
        const payroll: Workbench | null = isHR || operations.finance
          ? await rpc('hr_payroll_workbench', { p_org: org, p_period: periodDate }) : null;
        if (!ignore) setData({ period, operations, payroll });
      } catch (error) {
        if (!ignore) {
          const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
          setData(null);
          setError(code === 'PGRST202' ? 'Workflows require a database update. Contact your workspace administrator.' : message(error));
        }
      }
    })();
    return () => { ignore = true; };
  }, [org, period, periodDate, isHR, revision]);

  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.heading}>Workflows</Text>
    <View style={s.row}>{sections.map(item => <Button key={item} label={item} selected={active === item} secondary disabled={busy || !!editor}
      onPress={() => { setUpdated(false); setSection(item); }} />)}</View>
    {!editor && active !== 'People tasks' && <MonthPicker period={period} onChange={next => { setUpdated(false); setError(''); setPeriod(next); }} disabled={busy} />}
    {!editor && <View style={s.row}><Button label="Refresh" secondary disabled={busy} onPress={() => { setError(''); setRevision(value => value + 1); }} /></View>}
    {editor && active !== 'People tasks' && <Text style={s.small}>{monthName(period)}</Text>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {updated && !editor && !error && <Text accessibilityLiveRegion="polite" style={s.small}>Changes saved.</Text>}
    {!operations && !error && <Text style={s.small}>Loading workflows</Text>}
    {editor && <WorkflowForm editor={editor} onClose={() => setEditor(null)} />}
    {operations && !editor && <>
      {active === 'Payroll review' && payroll && <PayrollReview {...{ payroll, operations, isHR, userId, period, call, setEditor, employeeChoices, memberChoices }} />}
      {active === 'Reconciliation' && <Reconciliation {...{ org, operations, call, setEditor }} />}
      {active === 'My records' && <MyRecords {...{ org, operations, isHR, userId, periodDate, call, setEditor }} />}
      {active === 'Attendance' && <Attendance {...{ operations, isHR, userId, periodDate, manager: membership.role === 'manager', call, setEditor }} />}
      {active === 'People tasks' && <PeopleTasks {...{ operations, isHR, userId, call, setEditor, employeeChoices, memberChoices }} />}
    </>}
  </View>;
}

type Panel = { operations: Operations; call: Action; setEditor: (editor: Editor) => void };
type PeopleChoices = { employeeChoices: Choice[]; memberChoices: Choice[] };

function PayrollReview({ payroll, operations, isHR, userId, period, call, setEditor, employeeChoices, memberChoices }: Panel & PeopleChoices & {
  payroll: Workbench; isHR: boolean; userId: string; period: string;
}) {
  const run = payroll.run;
  const editable = isHR && (!run || run.status === 'returned');
  const hasOtherReviewer = payroll.reviewers.some(reviewer => reviewer !== userId);
  const reviewable = payroll.finance && run?.status === 'submitted' && run.submitted_by !== userId;
  const missing = payroll.rows.filter(row => row.version === null).length;
  const overtime = new Map(operations.overtime.map(entry => [entry.employee_id, entry]));
  function review(action: string) {
    setEditor({
      title: action === 'submit' ? 'Submit payroll to Finance' : action === 'return' ? 'Return payroll to HR' : 'Approve payroll and publish payslips',
      inputs: [{ key: 'comment', label: action === 'return' ? 'Return comment' : 'Comment (optional)', multiline: true }],
      save: ({ comment }) => call('hr_payroll_review', { p_period: month(period), p_action: action, p_version: run?.version ?? null, p_comment: comment }),
    });
  }
  function schedule() {
    setEditor({ title: 'Schedule recurring compensation', inputs: [
      { key: 'employee', label: 'Employee', choices: employeeChoices, pick: true },
      { key: 'effective', label: 'First payroll month (YYYY-MM)', initial: period },
      { key: 'basic', label: 'New monthly basic pay (ZMW)', inputMode: 'decimal' }, { key: 'allowance', label: 'New recurring allowances (ZMW)', initial: '0', inputMode: 'decimal' },
      { key: 'reason', label: 'Reason for change' },
    ], save: ({ employee, effective, basic, allowance, reason }) => call('hr_schedule_compensation', {
      p_employee: required(employee), p_effective: month(effective), p_basic: amount(basic), p_allowance: amount(allowance), p_reason: required(reason),
    }) });
  }
  return <>
    <Text style={s.heading}>Payroll review</Text>
    <Text style={s.label}>{run?.status ?? 'Draft'} · {missing} missing drafts</Text>
    {!!run?.comment && <Text style={s.subtitle}>{run.comment}</Text>}
    <View style={s.row}>
      {editable && <Button label="Submit to Finance" disabled={!hasOtherReviewer || missing === payroll.rows.length || period.slice(0, 4) !== '2026'} onPress={() => review('submit')} />}
      {reviewable && <><Button label="Approve payroll" onPress={() => review('approve')} /><Button label="Return to HR" secondary onPress={() => review('return')} /></>}
      {isHR && <Button label="Schedule pay change" disabled={!employeeChoices.length} secondary onPress={schedule} />}
      {isHR && <Button label="Finance access" secondary onPress={() => setEditor({
        title: 'Finance review access', inputs: [
          { key: 'member', label: 'Workspace member', pick: true, choices: memberChoices.map(choice => ({
            ...choice, label: payroll.reviewers.includes(choice.value) ? choice.label + ' (Finance)' : choice.label,
          })) },
          { key: 'access', label: 'Access', choices: options(['Grant', 'Revoke']) },
        ], save: ({ member, access }) => call('hr_finance_access', { p_user: required(member), p_enabled: access === 'Grant' }),
      })} />}
    </View>
    {editable && !hasOtherReviewer && <Text style={s.small}>Grant Finance access to another workspace member before submitting.</Text>}
    {payroll.rows.map(row => {
      const gross = (row.basic ?? 0) + (row.additional ?? 0);
      const change = row.previous_gross === null || row.basic === null ? null : gross - row.previous_gross;
      const scheduledThisMonth = row.scheduled?.effective_on === period + '-01';
      const requested = overtime.get(row.employee_id);
      const estimate = row.basic === null ? null : suggestZambiaDeductions(period, row.basic, row.additional ?? 0);
      const nextBasic = row.scheduled?.basic_minor ?? row.previous_basic;
      const nextAllowance = row.scheduled?.allowance_minor ?? row.previous_allowance;
      return <View key={row.employee_id} style={s.nestedCard}>
        <Text style={s.label}>{row.name}</Text>
        <Text style={s.small}>{row.basic === null ? 'Missing payroll draft' : `Gross ${money(gross)}${estimate ? ' · Estimated net ' + money(estimate.net) : ''}`}</Text>
        {change !== null && change !== 0 && <Text style={s.small}>Change from last month · {money(change)}
          {Math.abs(change) >= (row.previous_gross ?? 0) * 0.2 ? ' · Review change of 20% or more' : ''}
          {!scheduledThisMonth && !row.bonus && !row.overtime ? ' · Check the reason' : ''}</Text>}
        {(!!row.bonus || !!row.overtime) && <Text style={s.small}>Bonus {money(row.bonus ?? 0)} · Overtime {money(row.overtime ?? 0)}</Text>}
        {!!row.bonus && row.bonus === row.previous_bonus && <Text style={s.small}>Same bonus as last month. Check for duplicate entry.</Text>}
        {row.scheduled && <Text style={s.small}>{row.scheduled.effective_on} · {row.scheduled.reason} · Basic {money(row.scheduled.basic_minor)} · Allowances {money(row.scheduled.allowance_minor)}</Text>}
        {requested && requested.imported !== requested.amount && <Text style={s.small}>Approved overtime awaiting import · {money(requested.amount)}</Text>}
        <View style={s.row}>
          {editable && nextBasic !== null && nextAllowance !== null && <Button label={row.scheduled ? 'Apply scheduled pay' : 'Carry forward recurring pay'} secondary onPress={() => setEditor({
            title: 'Apply recurring pay for ' + row.name,
            inputs: [
              { key: 'basic', label: 'Basic pay (ZMW)', initial: initialAmount(nextBasic) },
              { key: 'allowances', label: 'Recurring allowances (ZMW)', initial: initialAmount(nextAllowance) },
            ],
            save: ({ basic, allowances }) => call('hr_apply_recurring_pay', {
              p_employee: row.employee_id, p_period: month(period), p_base: amount(basic), p_allowance: amount(allowances), p_version: row.version,
            }),
          })} />}
          {editable && row.version !== null && requested && requested.imported !== requested.amount && <Button label="Import overtime" secondary onPress={() => setEditor({
            title: 'Import ' + money(requested.amount) + ' of approved overtime', inputs: [],
            save: () => call('hr_import_overtime', { p_employee: row.employee_id, p_period: month(period), p_version: row.version }),
          })} />}
        </View>
      </View>;
    })}
  </>;
}

function Reconciliation({ org, operations, call, setEditor }: Panel & { org: string }) {
  const reconciliation = operations.reconciliation;
  if (!reconciliation) return <Text style={s.small}>Approve a payroll run to reconcile its statutory contributions.</Text>;
  const employeeShare = { PAYE: reconciliation.paye, NAPSA: reconciliation.napsa, NHIMA: reconciliation.nhima };
  return <>
    <Text style={s.heading}>Statutory reconciliation</Text>
    {agencies.map(agency => {
      const employee = employeeShare[agency];
      const employer = agency === 'PAYE' ? 0 : employee;
      const payments = reconciliation.payments.filter(payment => payment.agency === agency);
      const paid = payments.reduce((total, payment) => total + payment.paid_minor, 0);
      const balance = employee + employer - paid;
      return <View key={agency} style={s.nestedCard}>
        <Text style={s.label}>{agency}</Text>
        <Text style={s.small}>Withheld {money(employee)} · Employer {money(employer)} · Remitted {money(paid)}</Text>
        <Text style={s.label}>{balance >= 0 ? 'Outstanding' : 'Overpayment'} {money(Math.abs(balance))}</Text>
        {payments.map(payment => <View key={payment.id} style={s.form}>
          <Text style={s.small}>{payment.paid_on} · {payment.reference} · {money(payment.paid_minor)}</Text>
          <WorkflowDocument org={org} record={payment.id} kind="receipt" canUpload={operations.finance} />
        </View>)}
        {operations.finance && <Button label="Record remittance" secondary onPress={() => setEditor({
          title: 'Record ' + agency + ' remittance', inputs: [
            { key: 'total', label: 'Amount paid (ZMW)', initial: initialAmount(Math.max(balance, 0)) },
            { key: 'date', label: 'Payment date (YYYY-MM-DD)', initial: companyDateKey() },
            { key: 'reference', label: 'Filing or receipt reference' },
          ],
          save: values => call('hr_record_remittance', { p_run: reconciliation.run_id, p_agency: agency, p_amount: amount(values.total),
            p_paid_on: date(values.date), p_reference: required(values.reference) }),
        })} />}
      </View>;
    })}
  </>;
}

function MyRecords({ org, operations, isHR, userId, periodDate, call, setEditor }: Panel & { org: string; isHR: boolean; userId: string; periodDate: string }) {
  const ownEmployee = operations.employee;
  return <>
    <Text style={s.heading}>My records</Text>
    {operations.leave_balance !== null && <Text style={s.label}>{operations.leave_balance} days of leave available</Text>}
    {ownEmployee && !operations.payslips.length && <Text style={s.small}>No approved payslip for this month.</Text>}
    {operations.payslips.map(slip => <View key={slip.run_id} style={s.nestedCard}>
      <Text style={s.label}>Payslip · {slip.period.slice(0, 7)}</Text>
      <Text style={s.small}>Basic {money(slip.base_minor)} · Bonus {money(slip.bonus_minor)} · Gross {money(slip.gross_minor)}</Text>
      <Text style={s.small}>PAYE {money(slip.paye)} · NAPSA {money(slip.napsa)} · NHIMA {money(slip.nhima)}</Text>
      <Text style={s.label}>Net pay {money(slip.gross_minor - slip.paye - slip.napsa - slip.nhima)}</Text>
    </View>)}
    {operations.contracts.map(contract => <View key={contract.id} style={s.nestedCard}>
      <Text style={s.label}>{contract.title}</Text>
      <Text style={s.small}>{contract.start_date}{contract.end_date ? ' to ' + contract.end_date : ''}</Text>
      {contract.basic_minor !== null && <Text style={s.small}>Monthly basic pay {money(contract.basic_minor)}</Text>}
      {!!contract.pay_terms && <Text style={s.small}>{contract.pay_terms}</Text>}
      <WorkflowDocument org={org} record={contract.id} kind="contract" />
    </View>)}
    <Text style={s.heading}>Payroll queries</Text>
    {ownEmployee && <Button label="Raise a payroll query" onPress={() => setEditor({ title: 'Payroll query for ' + periodDate.slice(0, 7),
      inputs: [{ key: 'question', label: 'Question', multiline: true }],
      save: ({ question }) => call('hr_payroll_query', { p_employee: ownEmployee, p_period: periodDate, p_question: required(question) }),
    })} />}
    {!operations.queries.length && <Text style={s.small}>No queries for this month.</Text>}
    {operations.queries.map(query => <View key={query.id} style={s.nestedCard}>
      <Text style={s.label}>{query.name} · {query.resolved_at ? 'Resolved' : query.owner_id ? 'Assigned' : 'Open'}</Text>
      <Text style={s.subtitle}>{query.question}</Text>
      {!!query.reply && <Text style={s.small}>{query.reply}</Text>}
      {!query.resolved_at && (isHR || operations.finance) && <Button label={query.owner_id === userId ? 'Update query' : 'Take ownership or respond'}
        secondary onPress={() => setEditor({ title: 'Update payroll query', inputs: [
          { key: 'reply', label: 'Reply (required to resolve)', initial: query.reply ?? '', multiline: true },
          { key: 'status', label: 'Status', choices: options(['Keep open', 'Resolve']) },
        ], save: ({ reply, status }) => call('hr_reply_payroll_query', { p_id: query.id, p_reply: reply, p_resolve: status === 'Resolve' }) })} />}
    </View>)}
  </>;
}

function Attendance({ operations, isHR, manager, userId, periodDate, call, setEditor }: Panel & { isHR: boolean; manager: boolean; userId: string; periodDate: string }) {
  const mine = operations.timesheets.find(entry => entry.employee_id === operations.employee);
  const employee = operations.employee;
  const cutoff = operations.cutoff;
  return <>
    <Text style={s.heading}>Attendance and overtime</Text>
    {cutoff && <Text style={s.small}>Payroll cut-off · {cutoff}</Text>}
    {operations.payroll_locked && <Text style={s.small}>Attendance for this month is locked with payroll.</Text>}
    {isHR && !operations.payroll_locked && <Button label="Set attendance cut-off" secondary onPress={() => setEditor({
      title: 'Attendance cut-off',
      inputs: [{ key: 'cutoff', label: 'Cut-off date (YYYY-MM-DD)', initial: cutoff ?? '' }],
      save: values => call('hr_set_attendance_cutoff', { p_period: periodDate, p_cutoff: date(values.cutoff) }),
    })} />}
    {!!operations.expected_timesheets.length && <Text style={s.small}>Missing timesheets · {operations.expected_timesheets.join(', ')}</Text>}
    {employee && !operations.payroll_locked && (!mine || mine.status === 'returned') && <Button label={mine ? 'Resubmit timesheet' : 'Submit timesheet'} onPress={() => setEditor({
      title: 'Monthly timesheet', inputs: [
        { key: 'regular', label: 'Regular time in minutes', initial: String(mine?.regular_minutes ?? 0), inputMode: 'numeric' },
        { key: 'overtime', label: 'Overtime in minutes', initial: String(mine?.overtime_minutes ?? 0), inputMode: 'numeric' },
      ],
      save: ({ regular, overtime }) => call('hr_submit_timesheet', {
        p_employee: employee, p_period: periodDate, p_regular: minutes(regular), p_overtime: minutes(overtime), p_version: mine?.version ?? null,
      }),
    })} />}
    {!operations.timesheets.length && <Text style={s.small}>No timesheets submitted for this month.</Text>}
    {operations.timesheets.map(entry => <View key={entry.id} style={s.nestedCard}>
      <Text style={s.label}>{entry.name} · {entry.status}</Text>
      <Text style={s.small}>Regular {(entry.regular_minutes / 60).toFixed(2)} hours · Overtime {(entry.overtime_minutes / 60).toFixed(2)} hours</Text>
      {entry.status === 'approved' && <Text style={s.small}>Approved overtime pay {money(entry.overtime_minor)}</Text>}
      {entry.status === 'approved' && cutoff && entry.reviewed_at && companyDateKey(new Date(entry.reviewed_at)) > cutoff
        && <Text style={s.small}>Approved after cut-off</Text>}
      {(isHR || manager) && !operations.payroll_locked && entry.status === 'submitted' && entry.submitted_by !== userId && <Button label="Review timesheet" secondary onPress={() => setEditor({
        title: 'Review ' + entry.name + ' timesheet', inputs: [
          { key: 'decision', label: 'Decision', choices: options(['Approve', 'Return']) },
          { key: 'overtime', label: 'Approved overtime pay (ZMW)', initial: '0', inputMode: 'decimal' },
        ],
        save: ({ decision, overtime }) => call('hr_review_timesheet', {
          p_id: entry.id, p_version: entry.version, p_approve: decision === 'Approve', p_amount: decision === 'Approve' ? amount(overtime) : 0,
        }),
      })} />}
    </View>)}
  </>;
}

const categories = ['onboarding', 'offboarding', 'renewal', 'probation'];

function PeopleTasks({ operations, isHR, userId, call, setEditor, employeeChoices, memberChoices }: Panel & PeopleChoices & { isHR: boolean; userId: string }) {
  function create(renewal?: Renewal) {
    setEditor({ title: renewal ? 'Assign contract renewal review' : 'Assign people task', inputs: [
      { key: 'employee', label: 'Employee', initial: renewal?.employee_id, choices: employeeChoices, pick: true },
      { key: 'owner', label: 'Task owner', initial: renewal?.manager_user_id ?? userId, choices: memberChoices },
      { key: 'category', label: 'Task type', initial: renewal ? 'renewal' : undefined, choices: options(categories) },
      { key: 'title', label: 'Task', initial: renewal ? 'Review ' + renewal.title : undefined },
      { key: 'due', label: 'Due date (YYYY-MM-DD)', initial: renewal?.end_date ?? companyDateKey() },
    ], save: values => call('hr_create_work_task', { p_employee: required(values.employee), p_owner: required(values.owner),
      p_category: values.category, p_title: required(values.title), p_due: date(values.due) }) });
  }
  const today = companyDateKey();
  return <>
    <Text style={s.heading}>People tasks</Text>
    {isHR && <View style={s.row}>
      <Button label="Assign task" disabled={!employeeChoices.length} onPress={() => create()} />
      <Button label="Create checklist" disabled={!employeeChoices.length} secondary onPress={() => setEditor({
        title: 'Create an onboarding or offboarding checklist',
        inputs: [
          { key: 'employee', label: 'Employee', choices: employeeChoices, pick: true },
          { key: 'category', label: 'Checklist type', choices: options(['onboarding', 'offboarding']) },
          { key: 'due', label: 'Due date (YYYY-MM-DD)', initial: companyDateKey() },
          ...['HR', 'Manager', 'Finance', 'IT'].map(team => ({ key: team, label: team + ' task owner', choices: memberChoices, pick: true })),
        ],
        save: values => call('hr_create_checklist', {
          p_employee: required(values.employee), p_category: values.category, p_due: date(values.due),
          p_hr: required(values.HR), p_manager: required(values.Manager), p_finance: required(values.Finance), p_it: required(values.IT),
        }),
      })} />
    </View>}
    {!!operations.renewals.length && <Text style={s.label}>Contracts ending in the next 60 days</Text>}
    {operations.renewals.map(renewal => <View key={renewal.id} style={s.nestedCard}>
      <Text style={s.label}>{renewal.name} · {renewal.title}</Text>
      <Text style={s.small}>Ends {renewal.end_date}</Text>
      {isHR && <Button label="Assign renewal review" secondary onPress={() => create(renewal)} />}
    </View>)}
    {!operations.tasks.length && <Text style={s.small}>No assigned people tasks.</Text>}
    {operations.tasks.map(task => <View key={task.id} style={s.nestedCard}>
      <Text style={s.label}>{task.title}</Text>
      <Text style={s.small}>{task.name} · {task.category} · {task.completed_at ? 'Complete' : (task.due_on < today ? 'Overdue ' : 'Due ') + task.due_on}</Text>
      {isHR && <Text style={s.small}>Owner · {memberChoices.find(choice => choice.value === task.owner_id)?.label ?? 'Unassigned'}</Text>}
      {!!task.result && <Text style={s.subtitle}>{task.result}</Text>}
      {!task.completed_at && (isHR || task.owner_id === userId) && <Button label="Record outcome" secondary onPress={() => {
        const schedule = isHR && ['renewal', 'probation'].includes(task.category);
        setEditor({ title: task.title, inputs: [
          { key: 'result', label: 'Outcome or completion notes', multiline: true },
          ...(schedule ? [
            { key: 'effective', label: 'New pay effective month (optional, YYYY-MM)' },
            { key: 'basic', label: 'New basic pay (ZMW)' }, { key: 'allowance', label: 'New allowances (ZMW)', initial: '0' },
          ] : []),
        ], save: values => {
          const effective = values.effective?.trim();
          return call('hr_complete_work_task', { p_id: task.id, p_result: required(values.result),
            p_effective: effective ? month(effective) : null,
            p_basic: effective ? amount(values.basic) : null, p_allowance: effective ? amount(values.allowance) : null,
          });
        } });
      }} />}
    </View>)}
  </>;
}

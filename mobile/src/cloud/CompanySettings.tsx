import { type ReactNode, useEffect, useRef, useState } from 'react';
import { setStringAsync } from 'expo-clipboard';
import { Pressable, Text, View } from 'react-native';
import { CompanyProfile, CompanySettings, loadCompanySettings, NumberingPolicy, PayPoint, rpc } from './api';
import { companyDateKey } from './leaveCalendar';
import { companyTypes } from './companyRegistration';
import { Button, Field, FieldPair, s } from './workspaceDesign';

type Settings = Awaited<ReturnType<typeof loadCompanySettings>>;
type Save = (name: string, args: Record<string, unknown>, success: string) => Promise<boolean>;
type FormFeedback = { busy: boolean; save: Save; feedback: ReactNode };
type ProfileText = Exclude<keyof CompanyProfile, 'work_days' | 'workers_compensation'>;

const missingFields = {
  tpin: 'ZRA TPIN', napsa: 'NAPSA employer account number', nhima: 'NHIMA employer account number',
  legal_name: 'Registered legal name', address: 'Official address', business: 'Nature of the business',
  signatory: 'Contract signatory', signatory_title: 'Signatory position',
} satisfies Partial<Record<ProfileText, string>>;

const industries = ['Education', 'Agriculture', 'Construction', 'Finance', 'Health', 'Hospitality', 'Manufacturing',
  'Mining', 'Professional services', 'Retail', 'Technology', 'Transport', 'Other'];
const paymentMethods = [
  ['varies', 'Varies by employee'], ['bank', 'Bank transfer'], ['mobile', 'Mobile money'], ['cash', 'Cash'], ['cheque', 'Cheque'],
];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress}
    style={[s.button, s.secondary, selected && s.filterSelected]}>
    <Text style={[s.secondaryText, selected && s.filterText]}>{selected ? '✓  ' : '○  '}{label}</Text>
  </Pressable>;
}

function Select({ label, options, value, onChange }: {
  label: string; options: string[][]; value: string; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 6 }}>
    <Text style={s.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}, ${options.find(([key]) => key === value)?.[1] ?? 'Select'}`}
      onPress={() => setOpen(!open)} style={s.input}>
      <Text style={s.label}>{options.find(([key]) => key === value)?.[1] ?? 'Select'}  ▾</Text>
    </Pressable>
    {open && <View style={s.row}>{options.map(([key, name]) =>
      <Button key={key} label={name} secondary selected={value === key} onPress={() => { onChange(key); setOpen(false); }} />)}
    </View>}
  </View>;
}

export function CompanySettingsScreen({ org, payPoints, onSaved }: { org: string; payPoints: PayPoint[]; onSaved: () => Promise<void> }) {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [lastAction, setLastAction] = useState('');
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    void loadCompanySettings(org).then(data => { if (active) setSettings(data); }, (err: Error) => {
      if (active) setError(err.message);
    });
    return () => { active = false; };
  }, [org, attempt]);

  function reload() {
    setSettings(undefined);
    setLastAction('');
    setError('');
    setNotice('');
    setAttempt(value => value + 1);
  }

  const save: Save = async (name, args, success) => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setLastAction(name);
    setError('');
    setNotice('');
    try {
      await rpc(name, { p_organization_id: org, ...args });
      setNotice(success);
      if (name !== 'hr_add_pay_point') {
        try { setSettings(await loadCompanySettings(org)); }
        catch { setError('Changes were saved. Reload settings to see the latest version.'); }
      }
      await onSaved();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  function feedback(action: string) {
    if (action !== lastAction) return null;
    return <>
      {!!error && <>
        <Text accessibilityRole="alert" style={s.error}>{error}</Text>
        <Button label="Reload settings" secondary disabled={busy} onPress={reload} />
      </>}
      {!!notice && <Text accessibilityRole="alert" style={s.message}>{notice}</Text>}
    </>;
  }
  return <>
    {!settings && !!error && <View style={s.card}>
      <Text accessibilityRole="alert" style={s.error}>{error}</Text>
      <Button label="Reload settings" secondary disabled={busy} onPress={reload} />
    </View>}
    {!settings && !error && <Text style={s.subtitle}>Loading company settings…</Text>}
    {!!settings && <>
      <ProfileForm key={settings.profile_version} settings={settings} busy={busy} save={save} feedback={feedback('hr_save_company_profile')} />
      <NumberingForm key={settings.numbering_version} settings={settings} payPoints={payPoints} busy={busy} save={save} feedback={feedback('hr_save_numbering')} />
      <PayPointsForm payPoints={payPoints} busy={busy} save={save} feedback={feedback('hr_add_pay_point')} />
    </>}
  </>;
}

function ProfileForm({ settings, busy, save, feedback }: FormFeedback & { settings: Settings }) {
  const [name, setName] = useState(settings.hr_organizations.name);
  const [profile, setProfile] = useState(settings.profile);
  const [copyStatus, setCopyStatus] = useState('');
  const [error, setError] = useState('');
  const missing = Object.entries(missingFields).filter(([key]) => !settings.profile[key as ProfileText]?.trim());
  const companyType = companyTypes.find(([key]) => key === settings.company_type)?.[1];
  function field(key: ProfileText, label: string, inputMode?: 'tel' | 'email' | 'numeric') {
    return <Field label={label} value={profile[key] ?? ''} inputMode={inputMode}
      onChange={value => setProfile(previous => ({ ...previous, [key]: value }))} />;
  }
  async function copyAccountNumber() {
    try {
      const copied = await setStringAsync(settings.hr_organizations.account_number);
      setCopyStatus(copied ? 'Account number copied.' : 'Select the account number to copy it.');
    } catch {
      setCopyStatus('Select the account number to copy it.');
    }
  }
  async function submit() {
    const values = Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
    if (name.trim().length < 2 || name.trim().length > 120) {
      setError('Enter a company name between 2 and 120 characters.');
      return;
    }
    if (!profile.work_days.length) {
      setError('Choose at least one ordinary working day.');
      return;
    }
    setError('');
    await save('hr_save_company_profile', { p_name: name.trim(), p_profile: values, p_version: settings.profile_version }, 'Company profile saved.');
  }
  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.heading}>Company profile</Text>
    <View style={s.nestedCard}>
      <Text style={s.small}>easyHR account number</Text>
      <Text selectable style={s.heading}>{settings.hr_organizations.account_number}</Text>
      <Button label="Copy account number" secondary onPress={() => void copyAccountNumber()} />
      {!!copyStatus && <Text accessibilityRole="alert" style={s.small}>{copyStatus}</Text>}
    </View>
    {!!missing.length && <View style={s.nestedCard}>
      <Text style={s.label}>Employer details still missing</Text>
      <View style={s.row}>{missing.map(([key, label]) =>
        <View key={key} style={[s.badge, s.badgePending]}><Text style={s.label}>{label}</Text></View>)}</View>
    </View>}
    <Field label="Company name" value={name} onChange={setName} />
    {!!companyType && <View style={{ gap: 6 }}>
      <Text style={s.label}>Company type</Text>
      <Text style={s.subtitle}>{companyType}</Text>
    </View>}
    <FieldPair first={field('phone', 'Phone', 'tel')} second={field('email', 'Company email', 'email')} />
    {field('address', 'Official address')}
    <FieldPair first={field('city', 'Town or city')} second={field('postal_address', 'Postal address')} />
    <Text accessibilityRole="header" style={s.heading}>Employer particulars for contracts</Text>
    <FieldPair first={field('legal_name', 'Registered legal name')} second={field('trading_name', 'Trading name (if different)')} />
    {field('registration_number', 'Company registration number')}
    <Select label="Industry" options={[['', 'Select an industry'], ...industries.map(item => [item, item])]}
      value={profile.industry ?? ''} onChange={industry => setProfile(previous => ({ ...previous, industry }))} />
    {field('business', 'Nature of the business')}
    <FieldPair first={field('signatory', 'Person who signs contracts')} second={field('signatory_title', 'Signatory position')} />
    <Text accessibilityRole="header" style={s.heading}>Work and pay schedule</Text>
    <Text style={s.label}>Ordinary working days</Text>
    <View style={s.row}>{weekdays.map((day, index) => {
      const value = index + 1;
      const selected = profile.work_days.includes(value);
      return <Choice key={day} label={day} selected={selected} onPress={() => setProfile(previous => ({
        ...previous, work_days: previous.work_days.includes(value)
          ? previous.work_days.filter(entry => entry !== value)
          : [...previous.work_days, value].sort((a, b) => a - b),
      }))} />;
    })}</View>
    {field('pay_day', 'Salary pay day (1–31)', 'numeric')}
    <Select label="Wages are paid by" options={paymentMethods} value={profile.payment_method}
      onChange={payment_method => setProfile(previous => ({ ...previous, payment_method }))} />
    <Text accessibilityRole="header" style={s.heading}>Statutory accounts</Text>
    {field('tpin', 'ZRA employer tax account (10-digit TPIN)', 'numeric')}
    {field('napsa', 'NAPSA employer account number', 'numeric')}
    {field('nhima', 'NHIMA employer account number', 'numeric')}
    <Choice label="Registered with the Workers’ Compensation Fund Control Board" selected={profile.workers_compensation}
      onPress={() => setProfile(previous => ({ ...previous, workers_compensation: !previous.workers_compensation }))} />
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {feedback}
    <Button label="Save changes" disabled={busy} onPress={() => void submit()} />
  </View>;
}

function numberingPreview(policy: NumberingPolicy, branch: string) {
  const stem = [policy.include_branch ? branch : '', policy.prefix.trim().toUpperCase(),
    policy.include_year ? companyDateKey().slice(0, 4) : ''].filter(Boolean).join(policy.separator);
  const separator = stem && policy.separate_number ? policy.separator : '';
  return [0, 1, 2].map(offset => stem + separator + String(policy.next_number + offset).padStart(policy.digits, '0')).join('   ·   ');
}

function NumberingForm({ settings, payPoints, busy, save, feedback }: FormFeedback & { settings: CompanySettings; payPoints: PayPoint[] }) {
  const [draft, setDraft] = useState(settings);
  const [digits, setDigits] = useState(String(settings.digits));
  const [next, setNext] = useState(String(settings.next_number));
  const [error, setError] = useState('');
  const validSequence = /^[1-9][0-9]{0,11}$/.test(next);
  const validDigits = /^[1-9][0-9]?$/.test(digits) && Number(digits) <= 12;
  const toggles = {
    include_year: 'Include the year', include_branch: 'Include the pay point code',
    separate_number: 'Put the separator before the number',
  } as const;
  async function submit() {
    if (!/^[A-Z0-9]{0,12}$/i.test(draft.prefix.trim()) || !/^[-_/]?$/.test(draft.separator) || !validDigits || !validSequence) {
      setError('Use up to 12 letters or digits for the prefix, a blank separator or one of -, _ or /, a length of 1–12 and a positive next number.');
      return;
    }
    setError('');
    await save('hr_save_numbering', {
      p_version: settings.numbering_version, p_automatic: draft.automatic, p_prefix: draft.prefix,
      p_separator: draft.separator, p_digits: Number(digits), p_next_number: Number(next),
      p_include_year: draft.include_year, p_include_branch: draft.include_branch, p_separate_number: draft.separate_number,
    }, 'Employee numbering policy saved.');
  }
  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.heading}>Employee numbering</Text>
    <Text style={s.subtitle}>Choose how numbers are assigned to new employee records.</Text>
    <Select label="Numbering method" options={[[ 'auto', 'Generate automatically' ], [ 'manual', 'Enter numbers manually' ]]}
      value={draft.automatic ? 'auto' : 'manual'} onChange={method => setDraft(previous => ({ ...previous, automatic: method === 'auto' }))} />
    {draft.automatic && <>
      <FieldPair
        first={<Field label="Prefix" value={draft.prefix} onChange={prefix => setDraft(previous => ({ ...previous, prefix }))} />}
        second={<Field label="Separator" value={draft.separator} onChange={separator => setDraft(previous => ({ ...previous, separator }))} />}
      />
      <FieldPair first={<Field label="Number length" value={digits} onChange={setDigits} inputMode="numeric" />}
        second={<Field label="Next number" value={next} onChange={setNext} inputMode="numeric" />} />
      {(Object.keys(toggles) as (keyof typeof toggles)[]).map(key =>
        <Choice key={key} label={toggles[key]} selected={draft[key]}
          onPress={() => setDraft(previous => ({ ...previous, [key]: !previous[key] }))} />)}
      {validDigits && validSequence && <View style={s.nestedCard}>
        <Text style={s.small}>Number preview</Text>
        <Text style={s.label}>{numberingPreview({ ...draft, digits: Number(digits), next_number: Number(next) },
          payPoints.find(point => point.code)?.code ?? 'BR')}</Text>
      </View>}
    </>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {feedback}
    <Button label="Save numbering policy" disabled={busy} onPress={() => void submit()} />
  </View>;
}

function PayPointsForm({ payPoints, busy, save, feedback }: FormFeedback & { payPoints: PayPoint[] }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  async function submit() {
    if (!name.trim() || name.trim().length > 120 || !/^[A-Z0-9]{0,12}$/i.test(code.trim())) {
      setError('Enter a pay point name and use up to 12 letters or digits for its optional code.');
      return;
    }
    setError('');
    if (await save('hr_add_pay_point', { p_name: name, p_code: code }, 'Pay point added.')) {
      setName('');
      setCode('');
    }
  }
  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.heading}>Pay points</Text>
    <Text style={s.subtitle}>Add branches or payment locations for employee records.</Text>
    <FieldPair first={<Field label="Pay point name" value={name} onChange={setName} />}
      second={<Field label="Code (optional)" value={code} onChange={setCode} />} />
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {feedback}
    <Button label="Add pay point" disabled={busy} onPress={() => void submit()} />
    {payPoints.map(point => <View key={point.id} style={s.nestedCard}>
      <Text style={s.label}>{point.name}</Text>{!!point.code && <Text style={s.small}>{point.code}</Text>}
    </View>)}
    {!payPoints.length && <Text style={s.small}>No pay points yet.</Text>}
  </View>;
}

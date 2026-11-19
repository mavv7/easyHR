import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { supabase } from './client';
import { companyTypes, registrationPhone } from './companyRegistration';
import { Button, Field, s } from './workspaceDesign';

function useVerificationAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const working = useRef(false);
  async function run(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage('');
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not complete verification. Try again.'); }
    finally { working.current = false; setBusy(false); }
  }
  return { busy, message, setMessage, run };
}

export function CompanySignup({ initialEmail, onBack }: { initialEmail: string; onBack: (email: string) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [tpin, setTpin] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'register' | 'resume' | 'verify'>('register');
  const { busy, message, setMessage, run } = useVerificationAction();
  const auth = supabase!.auth;

  function register() {
    return run(async () => {
      const mobile = registrationPhone(phone);
      const address = email.trim().toLowerCase();
      if (name.trim().length < 2 || name.trim().length > 120) throw new Error('Enter a company name between 2 and 120 characters.');
      if (!type) throw new Error('Choose a company type.');
      if (!/^\d{10}$/.test(tpin.trim())) throw new Error('Enter your 10-digit TPIN.');
      if (!mobile) throw new Error('Enter a Zambian mobile number or include the international country code.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || password.length < 8) {
        throw new Error('Enter a valid email and a password of at least 8 characters.');
      }
      const { data: available, error: availabilityError } = await supabase!.rpc('hr_company_signup_available');
      if (availabilityError && availabilityError.code !== 'PGRST202') {
        throw new Error('Could not check company signup availability. Try again.');
      }
      if (!available) throw new Error('Company signup is waiting for the Supabase verification migration.');
      const { error } = await auth.signUp({
        email: address, password,
        options: { data: { company_name: name.trim(), company_type: type, tpin: tpin.trim(), registration_phone: mobile } },
      });
      if (error) throw error;
      setEmail(address);
      setPassword('');
      setStep('verify');
      setMessage('Check your work email for the verification code.');
    });
  }

  function resend() {
    return run(async () => {
      const address = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter a valid work email.');
      const { error } = await auth.resend({ email: address, type: 'signup' });
      if (error) throw error;
      setEmail(address);
      setPassword('');
      setCode('');
      setStep('verify');
      setMessage('Check your email for a new code. If you already verified your email, sign in to continue.');
    });
  }

  function verify() {
    return run(async () => {
      if (!/^\d+$/.test(code.trim())) throw new Error('Enter the code from your signup email.');
      const { data, error } = await auth.verifyOtp({ email, token: code.trim(), type: 'email' });
      if (error) throw error;
      if (!data.session) throw new Error('Your email was verified. Sign in to continue.');
    });
  }

  return <View style={{ gap: 15 }}>
    <Text accessibilityRole="header" style={s.title}>{step === 'register' ? 'Register your company' : 'Verify your email'}</Text>
    {step === 'register' && <>
      <Field label="Company name" value={name} onChange={setName} />
      <Text style={s.label}>Company type</Text>
      <View style={s.row}>{companyTypes.map(([value, label]) =>
        <Button key={value} label={label} secondary selected={type === value} onPress={() => setType(value)} />)}
      </View>
      <Field label="TPIN (10 digits)" value={tpin} onChange={setTpin} inputMode="numeric" />
      <Field label="Mobile number" value={phone} onChange={setPhone} inputMode="tel" />
    </>}
    {step !== 'verify' && <Field label="Work email" value={email} onChange={setEmail} inputMode="email" />}
    {step === 'register' && <Field label="Password" value={password} onChange={setPassword} secure />}
    {step === 'verify' && <>
      <Text style={s.subtitle}>Enter the code sent to {email}.</Text>
      <Field label="Email code" value={code} onChange={setCode} inputMode="numeric" />
    </>}
    {!!message && <Text accessibilityRole="alert" style={s.subtitle}>{message}</Text>}
    <Button label={step === 'register' ? 'Send email code' : step === 'resume' ? 'Request email code' : 'Verify email'}
      disabled={busy} onPress={() => void (step === 'register' ? register() : step === 'resume' ? resend() : verify())} />
    {step === 'register' && <Button label="Continue an existing registration" secondary disabled={busy} onPress={() => {
      setStep('resume'); setMessage('');
    }} />}
    {step === 'verify' && <Button label="Resend email code" secondary disabled={busy} onPress={() => void resend()} />}
    <Button label="Back to sign in" secondary disabled={busy} onPress={() => onBack(email)} />
  </View>;
}

export function EmployeeSignIn({ initialEmail, onBack }: { initialEmail: string; onBack: (email: string) => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const { busy, message, setMessage, run } = useVerificationAction();
  const auth = supabase!.auth;
  function send() {
    return run(async () => {
      const address = (sentTo || email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter your work email address.');
      const { error } = await auth.signInWithOtp({ email: address, options: { data: { employee_otp: true } } });
      if (error && !['unexpected_failure', 'signup_disabled', 'user_not_found'].includes(error.code ?? '')) throw error;
      setSentTo(address);
      setCode('');
      setMessage('If HR authorized this address, check your inbox for your sign-in code.');
    });
  }
  function verify() {
    return run(async () => {
      if (!/^\d+$/.test(code.trim())) throw new Error('Enter the code from your work email.');
      const { error } = await auth.verifyOtp({ email: sentTo, token: code.trim(), type: 'email' });
      if (error) throw error;
    });
  }
  return <View style={{ gap: 15 }}>
    <Text accessibilityRole="header" style={s.title}>Employee sign in</Text>
    {sentTo ? <>
      <Text style={s.subtitle}>Enter the code sent to {sentTo}.</Text>
      <Field label="Email code" value={code} onChange={setCode} inputMode="numeric" />
      <Button label="Verify email code" disabled={busy} onPress={() => void verify()} />
      <Button label="Resend email code" secondary disabled={busy} onPress={() => void send()} />
      <Button label="Change email address" secondary disabled={busy} onPress={() => { setSentTo(''); setMessage(''); }} />
    </> : <>
      <Text style={s.subtitle}>Use the work email your HR administrator added in People.</Text>
      <Field label="Work email" value={email} onChange={setEmail} inputMode="email" />
      <Button label="Send email code" disabled={busy} onPress={() => void send()} />
    </>}
    {!!message && <Text accessibilityRole="alert" style={s.subtitle}>{message}</Text>}
    <Button label="Back to sign in" secondary disabled={busy} onPress={() => onBack(email)} />
  </View>;
}

export function PhoneVerification({ initialPhone, employee, onVerified, onSignOut }: {
  initialPhone: string; employee: boolean; onVerified: () => Promise<void>; onSignOut: () => Promise<void>;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [sentTo, setSentTo] = useState<string>();
  const [code, setCode] = useState('');
  const { busy, message, setMessage, run } = useVerificationAction();
  const auth = supabase!.auth;
  const autoSent = useRef(false);
  useEffect(() => {
    if (!employee || autoSent.current) return;
    autoSent.current = true;
    void send();
  });

  function send() {
    return run(async () => {
      const mobile = registrationPhone(phone);
      if (!mobile) throw new Error('Enter a Zambian mobile number or include the international country code.');
      const { error } = await auth.updateUser({ phone: mobile });
      if (error) throw error;
      setPhone(mobile);
      setSentTo(mobile);
      setCode('');
      setMessage('Check your phone for the SMS code.');
    });
  }

  function verify(mobile: string) {
    return run(async () => {
      if (!/^\d+$/.test(code.trim())) throw new Error('Enter the code from your text message.');
      const { error } = await auth.verifyOtp({ phone: mobile, token: code.trim(), type: 'phone_change' });
      if (error) throw error;
      await onVerified();
    });
  }

  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.heading}>Verify your mobile number</Text>
    <Text style={s.subtitle}>{employee
      ? 'Your email is verified. Confirm the mobile number HR added to activate your workspace access.'
      : 'Your email is verified. Confirm your mobile number to finish creating your company workspace.'}</Text>
    {sentTo ? <>
      <Text style={s.label}>Code sent to {sentTo}</Text>
      <Field label="SMS code" value={code} onChange={setCode} inputMode="numeric" />
      <Button label="Verify mobile number" disabled={busy} onPress={() => void verify(sentTo)} />
      <Button label="Resend SMS code" secondary disabled={busy} onPress={() => void send()} />
      {!employee && <Button label="Change mobile number" secondary disabled={busy} onPress={() => { setSentTo(undefined); setMessage(''); }} />}
    </> : <>
      {employee ? <Text style={s.label}>{phone}</Text> : <Field label="Mobile number" value={phone} onChange={setPhone} inputMode="tel" />}
      <Button label={busy ? 'Sending SMS code…' : 'Send SMS code'} disabled={busy} onPress={() => void send()} />
    </>}
    {!!message && <Text accessibilityRole="alert" style={s.subtitle}>{message}</Text>}
    <Button label="Sign out" secondary disabled={busy} onPress={() => void run(onSignOut)} />
  </View>;
}

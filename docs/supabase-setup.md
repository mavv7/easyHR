# Supabase setup for easyHR

The connected MVP implements accounts, organization membership, employee records, leave and server-generated audit events. The existing six-module fictional demo remains accessible from the sign-in screen. Demo records are never uploaded automatically.

## Connect the project

1. Choose a dedicated development Supabase project. Connect the Supabase integration to let the assistant inspect and migrate the selected project, or apply the SQL files in `mobile/supabase/migrations` in version order in the project's SQL Editor. Each migration is transactional and should run once. Its tables use the `hr_` prefix; inspect existing schema before applying it to a shared project.
2. Copy `mobile/.env.example` to `mobile/.env.local` and fill in the project URL and **publishable key** from the project Connect/API dialog. A legacy anon key also works. Never put a service-role key, secret key or database password in an `EXPO_PUBLIC_*` variable: these values are included in application bundles.
3. Configure [company signup verification](#company-signup-verification) in Supabase Auth before registering a company.
4. Restart Expo with `cd mobile` then `npx.cmd expo start --clear`. The app shows a configuration screen if the URL/key are missing.
5. Choose **Register a company**, enter the company details and confirm the email code, then request and confirm the SMS code. Each company starts with an empty workspace, Zambia and ZMW defaults, and its registrar as HR.

## Company signup verification

Apply `202611190007_company_signup_otp.sql` after the company settings migration. Enable the Email and Phone providers in Supabase Auth and require confirmation for both. Configure SMTP for external recipients and an SMS provider that can deliver to your intended destinations, including Zambian numbers. Set an appropriate Site URL for employee confirmation links.

In the **Confirm signup** email template, use a code for new company registrations and HR-authorized employee sign-ins. The fallback supports older registrations.

```html
{{ if or (index .Data "company_type") (index .Data "employee_otp") }}
<p>Your easyHR email verification code is <strong>{{ .Token }}</strong>.</p>
<p>Enter this code in easyHR to continue.</p>
{{ else }}
<p><a href="{{ .ConfirmationURL }}">Confirm your easyHR email address</a></p>
{{ end }}
```

Verify delivery with a controlled inbox and mobile number. After the email code is verified, the app requests an SMS for the same signed-in account. Workspace activation checks both confirmation timestamps in Supabase Auth and stores the verified email and mobile number, company type and TPIN in Company Settings.

## Employee onboarding

Apply `202611190008_employee_onboarding.sql` after the company signup migration. Use the **Confirm signup** template above. Set the **Magic Link** email template to include `{{ .Token }}` so returning employees can also enter an email code in easyHR.

HR adds the employee from **People → Add employee** with their work email and Zambian mobile number. This prepares the authorization. The employee opens **Employee sign in**, verifies the email code, and then receives an SMS code at the number HR entered. The app links the account after both checks. HR can correct an unlinked employee's contact details under People or withdraw pending access under Workspace. Existing members retain access and earlier authorizations can still be completed.

## End-to-end acceptance flow

1. As HR, add an employee in People with their work email, Zambian mobile number and an initial leave allocation.
2. Check **Workspace → Pending authorizations** for the new employee.
3. On the employee device, choose **Employee sign in**, verify the email code, then verify the SMS code. Check that the pending authorization has become a linked workspace member.
4. Refresh the employee's app. They should see only their own record. Submit leave for whole weekdays.
5. As HR, refresh and approve the request. The request and employee balance update atomically. Refresh the employee app to see the outcome. Data also refreshes on foreground and every 30 seconds while active; this is polling, not Supabase Realtime.
6. For manager approval, change an activated employee's role to Manager in Workspace, then assign them to an employee under People. Managers see only their own record and assigned reports. Nobody can approve their own leave.

## Contracts and payroll drafts

In **Contracts**, HR can record an employee’s contract title, start and optional end dates, and mark the agreement internally reviewed. Edits return the record to review. Contract documents and signatures are handled separately.

In **Payroll**, HR opens a month and enters base and additional gross pay for each employee in ZMW. The total is draft gross pay from entered amounts. Tax, statutory contributions, deductions, net pay, payslips and payments are outside this workflow.

Both modules require migration `202611180005_contracts_payroll.sql`. Only HR members of the company can access these records. Audit events record who changed each record and when, with salary values kept in the payroll table.

## Company settings

Apply `202611190006_company_settings.sql` to enable the **Settings** section for HR. It shows the company's easyHR account number, missing employer details, company profile, work and pay preferences, statutory accounts, employee numbering and pay points. These preferences are stored for the company. Leave still uses its existing weekday calculation, and statutory exports and contract generation are outside the current workflow.

New employee records use the company's numbering policy. Automatic numbers use a company-wide sequence and can include the year and selected pay point code. Manual numbers are unique within the company. The migration preserves existing employee records, including records that predate employee numbering. Changing a policy or employee's pay point preserves their assigned number.

## Password recovery

In Supabase Authentication, edit the **Reset Password** email template so it includes the one-time code. For example, use the subject `Reset your easyHR password` and this body:

```html
<p>Your easyHR password reset code is <strong>{{ .Token }}</strong>.</p>
<p>Enter this code in easyHR to choose a new password.</p>
```

In easyHR, select **Forgot password?**, request a code, enter it, and choose a new password. Sign in again with the new password. The recovery session stays in memory and is isolated from the workspace session. Test delivery to a controlled inbox before enabling recovery for a team.

Signed-in users can also open **Account** to change their password using their current password or sign out other sessions. Supabase invalidates other refresh sessions while keeping the current session active. Previously issued access tokens can last until they expire.

## Access and data design

- Each company is a tenant in the shared PostgreSQL database. Memberships, employees, leave and audit events are nested under its organization ID, with composite foreign keys enforcing company ownership on employee and leave links.
- Row-level security applies to all five public tables. Clients have SELECT access filtered by membership and employee ownership/reporting relationship. Anonymous clients have no access.
- Write access is through narrowly scoped functions with explicit authorization and a fixed search path. The application never receives an administrative key.
- Membership roles are stored in the database, not editable user metadata. Existing memberships cannot be silently changed to another role via account linking.
- Leave operations lock the employee row, check pending reservations and overlaps, and perform balance/status/audit changes in one transaction. Repeating an approval does not deduct twice.
- Employee edits carry an expected version; stale edits fail rather than overwriting another person's changes. Pending leave cannot be erased by reducing the balance below reserved days.
- Audit events are append-only to app users. Database administrators retain administrative access, so this is not a tamper-proof external audit archive.
- Employee and leave data live only in memory on the device. Native session tokens use Expo SecureStore; storage errors are surfaced, not downgraded to plaintext. Large sessions may exceed device secure-storage limits and require further device testing. Browser previews use per-tab sessionStorage.
- Requests require a connection. There is no offline mutation queue or automatic replay. After an ambiguous network error, refresh before repeating a write.

## Verification

```powershell
cd mobile
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npx.cmd expo export --platform all
```

The database test applies the actual migration to PGlite (PostgreSQL in WASM), with a minimal Supabase Auth schema stub. It exercises RLS, role enforcement, company isolation, self-approval prevention, overlap checks, reserved balances, stale versions and atomic approval. It does not test hosted authentication, live network behavior, concurrent sessions or device Keychain/Keystore behavior. Run the acceptance flow above against the actual project before using real records.

## Before a real-team pilot

- Review RLS in Supabase and run the acceptance flow with at least two organizations and HR, manager and employee accounts.
- Verify role changes and revocation under Workspace. HR can manage other members, with the workspace owner and the signed-in administrator protected. Revocation preserves employee and leave records, clears linked access and manager assignments, and records an audit event.
- Verify email delivery for password recovery and add MFA and account lifecycle handling.
- Confirm backup/PITR availability for your Supabase plan and perform a restore drill. Backups are a project configuration requirement, not something this migration enables.
- Configure email delivery, rate limits, monitoring and data retention. Validate privacy/consent policies and employee access with the organization.
- Employees and HR can cancel pending leave, which releases reserved days and permits a replacement request for the same dates. Approved leave stays in the history with its balance deduction.
- HR can withdraw pending authorizations under Workspace. If the employee has already activated access, HR can revoke it from the active member list.
- Leave currently excludes weekends only. Zambia public holidays, partial days, leave types, accruals and statutory rules remain follow-on work.
- Compliance and attendance are still demo-only. Connected Contracts tracks metadata and internal review. Connected Payroll prepares draft gross pay.
- Workspace reads page through organizations, employees, leave requests, members and pending authorizations. The app still renders full workspace lists, so measure refresh and rendering times with representative large-company data.
- Produce a development/internal build with the SecureStore config plugin, then verify signed Android/iOS behavior on physical devices. No hosted migration, backup configuration or signed build is implied by local checks passing.

## Sources

- [Supabase React Native authentication](https://supabase.com/docs/guides/auth/quickstarts/react-native)
- [Supabase authentication email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase SMS provider setup](https://supabase.com/docs/guides/auth/phone-login)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Expo SDK 58 SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/)

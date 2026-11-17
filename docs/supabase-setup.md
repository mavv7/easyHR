# Supabase setup for easyHR

The connected MVP implements accounts, organization membership, employee records, leave and server-generated audit events. The existing six-module fictional demo remains accessible from the sign-in screen. Demo records are never uploaded automatically.

## Connect the project

1. Choose a dedicated development Supabase project. Connect the Supabase integration to let the assistant inspect and migrate the selected project, or apply the SQL files in `mobile/supabase/migrations` in version order in the project's SQL Editor. Each migration is transactional and should run once. Its tables use the `hr_` prefix; inspect existing schema before applying it to a shared project.
2. Copy `mobile/.env.example` to `mobile/.env.local` and fill in the project URL and **publishable key** from the project Connect/API dialog. A legacy anon key also works. Never put a service-role key, secret key or database password in an `EXPO_PUBLIC_*` variable: these values are included in application bundles.
3. In Supabase Authentication, enable email/password sign-in and email confirmation. Set an appropriate Site URL for the confirmation landing page. The current flow confirms in a browser and then asks users to return to the app and sign in; it does not consume tokens from a deep link. Configure production SMTP before inviting a team.
4. Restart Expo with `cd mobile` then `npx.cmd expo start --clear`. The app shows a configuration screen if the URL/key are missing.
5. Choose Register a company and enter the company name and HR administrator email. Confirm that email and sign in to activate the workspace. Each company starts with an empty workspace, Zambia and ZMW defaults, and its registrar as HR.

## End-to-end acceptance flow

1. As HR, add an employee with their work email and an explicitly chosen initial leave balance. This balance is an administrative allocation, not a statutory accrual calculation.
2. As HR, open Workspace and select Grant access / link account. Choose the employee record, matching work email and Employee role. Then tell the employee to activate access using that address.
3. On the employee device, choose Activate HR-approved access, use the authorized work email, confirm it and sign in. The app links the employee record during activation. HR can link an existing verified account immediately by granting its existing role.
4. Refresh the employee's app. They should see only their own record. Submit leave for whole weekdays.
5. As HR, refresh and approve the request. The request and employee balance update atomically. Refresh the employee app to see the outcome. Data also refreshes on foreground and every 30 seconds while active; this is polling, not Supabase Realtime.
6. For manager approval, grant a verified account Manager access, then edit the employee and assign that manager. Managers see only their own record and assigned reports. Nobody can approve their own leave.

## Password recovery

In Supabase Authentication, edit the **Reset Password** email template so it includes the one-time code. For example, use the subject `Reset your easyHR password` and this body:

```html
<p>Your easyHR password reset code is <strong>{{ .Token }}</strong>.</p>
<p>Enter this code in easyHR to choose a new password.</p>
```

In easyHR, select **Forgot password?**, request a code, enter it, and choose a new password. Sign in again with the new password. The recovery session stays in memory and is isolated from the workspace session. Test delivery to a controlled inbox before enabling recovery for a team.

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
- Leave currently excludes weekends only. Zambia public holidays, partial days, leave types, accruals, cancellations and statutory rules remain follow-on work.
- Payroll, contracts, compliance and attendance are still demo-only; document uploads and salary data are not part of these new tables.
- Pagination and large-company performance need additional work before exceeding the hosted API row cap (typically 1,000 records per query).
- Produce a development/internal build with the SecureStore config plugin, then verify signed Android/iOS behavior on physical devices. No hosted migration, backup configuration or signed build is implied by local checks passing.

## Sources

- [Supabase React Native authentication](https://supabase.com/docs/guides/auth/quickstarts/react-native)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Expo SDK 58 SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/)

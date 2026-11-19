# easyHR

Zambian HR workspace for Android, iOS and the web, built with React Native, Expo SDK 58 and TypeScript.

## Supabase workspace

Sign in to manage people, leave, contracts and payroll. HR, managers, employees and Finance reviewers get access to the records and actions relevant to them. The Overview links directly to payroll drafts, personal records and timesheets.

- Prepare monthly pay, import approved overtime and send payroll to Finance for review and payslip publication.
- Track PAYE, NAPSA and NHIMA remittances and attach PDF receipts. Standard monthly payroll approval covers 2026.
- Manage contract PDFs, leave requests, payroll queries, renewals, probation and onboarding or offboarding tasks.

See the [workflow guide](docs/workflows.md) and [Zambia payroll guide](docs/zambia-payroll.md).

Follow [Supabase setup](docs/supabase-setup.md) to configure the project, apply the database migrations and verify the connected workspace. The app reads the project URL and publishable key from `mobile/.env.local`.

## Run

```powershell
cd mobile
npm.cmd install
npm.cmd start
# Optional browser preview
npm.cmd run web
```

Use a compatible Expo Go client for development or configure a signed internal build. This repository does not contain a signed APK or IPA yet.

## Implemented demo workflows

- Today dashboard with live employee, pending leave and compliance counts.
- Searchable employee directory, profile details and employee creation.
- Leave requests with date and overlap validation, approval/decline and balance deduction.
- Clock in/out with local time entries.
- Monthly base-pay summary in ZMW and a payroll readiness checklist.
- Contract register with internal review tracking.
- Compliance task completion and local activity history.
- Demo state persists on the device using AsyncStorage.

The demo uses fictional records stored locally on the device. The connected workspace enforces record access in Supabase and uses secure native session storage. Payroll payments, statutory filings and legal signatures are handled outside easyHR.

## Checks

```powershell
cd mobile
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
npx.cmd expo export --platform all
```

## Installable distribution

The EAS profiles configure an Android APK for internal previews, iOS internal distribution (registered devices and Apple signing required), an iOS simulator build, and store production builds. Before building, replace the provisional bundle identifiers with identifiers owned by your organization, link your Expo project and configure your Apple/Google credentials.

```powershell
cd mobile
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest build:configure
npx.cmd eas-cli@latest build --platform android --profile preview
npx.cmd eas-cli@latest build --platform ios --profile preview
```

Cloud builds and store publication have not been performed. Native bundling is not the same as compiling and testing signed binaries on physical devices.

See [research and release plan](docs/research.md) for source material, security requirements and the broader HR roadmap.

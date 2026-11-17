# easyHR

Native Android and iOS HR application foundation for Zambia, built with React Native, Expo SDK 58 and TypeScript. Orange primary branding with lime accents; responsive layouts for phones and tablets, plus an optional browser preview.

## Supabase workspace

The app now opens with Supabase sign-in and company setup. Connected workflows include HR/manager/employee access, employee creation and editing, account linking, leave requests, atomic approvals and server audit history. The fictional local demo remains available separately from the sign-in screen.

Follow [Supabase setup](docs/supabase-setup.md) to configure the project, apply the database migration and test the workflow across devices. The integration needs your project URL and publishable key in `mobile/.env.local`. No hosted project is configured automatically.

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

The separate demo uses fictional records in unencrypted local storage and does not sync them. The connected workspace uses Supabase with database-enforced access rules and secure native session storage. Document handling, legal signatures, statutory payroll, payments and filings remain unimplemented. Public holidays, statutory accrual and partial-day leave are not implemented in either mode. See the Supabase setup guide for remaining pilot-readiness requirements.

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

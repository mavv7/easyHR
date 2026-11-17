# easyHR product research

Research date: 17 November 2026.

## Evidence and product decisions

- [BambooHR time and attendance](https://www.bamboohr.com/platform/time-and-attendance/) connects time tracking, time off, approvals and payroll. easyHR should keep employee identity and approval history shared across these modules, with mobile actions requiring few taps.
- [BambooHR mobile hours approval](https://help.bamboohr.com/s/article/1071802) includes period totals and corrections before approval. Timesheet review must eventually include adjustments, reasons and manager sign-off rather than a clock alone.
- [Expo build documentation](https://docs.expo.dev/build/setup/) supports installable Android and iOS artifacts. React Native with Expo is the selected native application foundation; a browser preview is optional.
- [OWASP MASVS](https://mas.owasp.org/MASVS/03-Using_the_MASVS/) defines storage, authentication, network and privacy controls. Production requires server-side organization and role authorization, audit logs, encrypted sensitive storage, secure session handling and data minimization.
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) is appropriate for session secrets, not an employee document database. The demo deliberately contains fictional records only.

## Workflow coverage

| Area | Initial local demo | Production scope |
| --- | --- | --- |
| Records | Search, employee creation and profile details | Documents, emergency contacts, custom fields, onboarding/offboarding, retention policies |
| Contracts | Contract register and internal review | Templates, versioning, document generation, legally appropriate e-signature provider, renewal reminders |
| Leave | Requests, approve/decline, balances | Country calendars, accruals, partial days, attachments, delegated approval and conflict detection |
| Attendance | Clock in/out and team status | Shifts, breaks, overtime, corrections, timesheet approvals, optional consent-based location |
| Payroll | Gross-pay preview and review gate | Effective-dated country rules, deductions, tax, pensions, payslips, dual approval, bank exports and reconciliation |
| Compliance | Task register and completion history | Jurisdiction-specific obligations, evidence attachments, owners, deadlines and statutory reports |

## Beyond the six core modules

Recruitment, onboarding checklists, performance reviews, training, benefits, expenses, employee self-service, announcements, reports and organization settings are follow-on requirements for a complete HR suite. Prioritize these with actual HR users after the core workflows are validated.

## Production architecture

Use an authenticated API backed by PostgreSQL with organization-scoped access policies, private object storage and append-only server audit events. HR admin, manager, employee and payroll specialist roles need distinct permissions. Offline mutations require idempotency keys, a visible pending queue and conflict resolution; approval and payroll finalization must be checked server-side. Push messages must avoid sensitive payloads. Provide accessible touch targets and screen-reader labels, biometric session unlock, device revocation, backups and recovery tests.

The user confirmed Zambia as the first jurisdiction. Currency is ZMW. Do not present illustrative gross totals as take-home pay, calculate invented tax rates or claim statutory compliance. Store money in integer minor units and version every ruleset by effective date. Validate against authority publications and payroll experts before financial use.

## Zambia source register

- [ZRA tax information](https://www.zra.org.zm/tax-information/) gives a 2026 monthly PAYE example: the first K5,100 at 0%, the next K2,000 at 20%, the next K2,100 at 30%, and the remainder at 37%. These are research inputs, not an implemented payroll engine. The page also explains that pension contributions are not deducted to determine chargeable income.
- [NAPSA contribution calculator](https://www.napsa.co.zm/self-service/calculators) requires a contribution year and applies a ceiling. The accessible page did not expose the 2026 ceiling; obtain and archive the authority’s dated annual notice before implementation.
- [NHIMA implementation notice](https://www.nhima.co.zm/download/document/0e98ec61c02019110104d23eb0.pdf) states employee and employer contributions of 1% each of monthly basic salary. This notice dates to 2019; verify any subsequent changes before releasing calculations.
- [Ministry of Labour FAQ handbook](https://www.mlss.gov.zm/wp-content/uploads/2023/10/FREQUENTLY-ASKED-QUESTIONS-AND-RESPONSES-HANDBOOK-WORKING-DOCUMENT-19TH-OCTOBER-2023.pdf) is a starting point for employment policy research. Statutory leave, overtime, termination, record retention and current amendments still require detailed verification.

The application intentionally calculates no statutory deductions yet. Compliance checklist entries represent internal preparation tasks, not completed authority submissions.

## Release gates

1. Confirm country, currency, company structure and HR roles.
2. Implement API, authentication, tenant isolation, secure document upload and audit persistence.
3. Validate leave rules, attendance policy and payroll calculations against jurisdiction-specific fixtures.
4. Test on physical Android and iOS devices, including accessibility, offline recovery and permission denial.
5. Configure owner-controlled bundle identifiers, signing credentials, privacy disclosures and store listings.
6. Produce signed Android and iOS builds; distribute through internal testing before public release.

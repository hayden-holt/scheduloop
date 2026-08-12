# ScheduleLoop Security Review

Date: 2026-08-12

Scope: the ScheduleLoop application repository at `hayden-holt/scheduloop`. The separate marketing website is out of scope.

## Critical

### Issue: public password signup could create unauthorised workspaces

What was found: the app exposed Firebase email/password signup and created business profiles under the signed-in user's UID. That made authentication and workspace authorisation too tightly coupled.

Risk: any newly authenticated account could attempt to create a ScheduleLoop business profile and store customer-like data.

What was changed: password login, signup, reset and password-change UI were removed. The app now uses Firebase email-link sign-in and requires an active `memberships/{uid}` document or an already-existing legacy self-owned profile before business data loads.

Remaining manual action: enable Firebase email-link sign-in, create membership documents for authorised managers, and disable/avoid password-based onboarding in operational processes.

### Issue: tenant isolation depended on UID-only ownership

What was found: the previous data model assumed `businessProfiles/{uid}` and subcollections belonged to the signed-in UID.

Risk: this was difficult to extend to multi-manager or organisation-level access and did not provide a clear membership boundary.

What was changed: client reads now derive `businessId` from trusted membership data. Firestore rules gate `businessProfiles/{businessId}`, `employees`, `shifts` and `rotaWeeks` by membership and require written documents to match the path `businessId`.

Remaining manual action: run emulator tests when Firebase tooling is available and test cross-tenant access with real staging accounts.

## High

### Issue: Firestore rules needed stronger role and field checks

What was found: rules protected the old profile path but did not model organisation membership or all rota subcollections.

Risk: future rota or multi-manager features could accidentally widen access.

What was changed: rules now deny membership writes from the client, restrict business data by active membership role, validate allowed top-level fields, prevent `businessId` spoofing, and deny unknown paths.

Remaining manual action: deploy `firestore.rules` and add Firebase emulator rule tests in CI when practical.

### Issue: App Check was not integrated

What was found: Firebase App Check was not initialized in the web app.

Risk: abuse of Firebase resources is easier from non-app clients if rules or quotas are misconfigured.

What was changed: App Check initializes with reCAPTCHA Enterprise when `VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY` is configured.

Remaining manual action: register the web app in Firebase App Check, monitor metrics, then enable enforcement.

### Issue: CSV upload validation was too light

What was found: CSV uploads had a size limit but not file type, row, column, duplicate header, cell length or formula-like value checks.

Risk: malformed or oversized CSV data could degrade the client, corrupt stored profile data or create future spreadsheet-injection risk if exported.

What was changed: CSV validation now checks extension, MIME type, max rows, max columns, max cell length, duplicate headers and spreadsheet formula-like cells before parsing.

Remaining manual action: keep sample data synthetic and review any future CSV export feature for formula escaping.

## Medium

### Issue: security headers were not configured

What was found: Firebase config contained Firestore settings only.

Risk: production hosting could miss CSP, clickjacking, MIME sniffing and referrer protections.

What was changed: `firebase.json` now includes Firebase Hosting headers and SPA rewrites.

Remaining manual action: if the app is not deployed on Firebase Hosting, copy equivalent headers into the actual hosting platform and test CSP.

### Issue: privacy and terms pages were missing from the app

What was found: the app had no in-app privacy or terms route.

Risk: managers could not review application-specific data handling and terms from login or settings.

What was changed: `/privacy` and `/terms` were added with clear TODO placeholders and legal-review warnings.

Remaining manual action: complete company details, lawful basis, retention, contact, ICO and governing-law placeholders before production.

### Issue: account and data-request processes were undocumented

What was found: account deletion, workspace removal and customer data handling were not documented.

Risk: support requests could be handled inconsistently.

What was changed: settings now points users to support for email/membership changes, and legal/security docs describe deletion and DPA review items.

Remaining manual action: define operational support steps and deletion runbooks before onboarding customers.

## Low

### Issue: production console logging could include internal errors

What was found: some auth/profile flows logged raw errors.

Risk: browser logs could expose internal Firebase details during troubleshooting.

What was changed: sensitive auth/profile paths now show safe user messages and limit detailed logs to development where updated.

Remaining manual action: review remaining rota/dashboard error logs before adding analytics or remote logging.

### Issue: dependency posture needed review

What was found: the app depends on Firebase, React, Vite, Recharts and development tooling.

Risk: vulnerable dependencies could affect the app even if code is correct.

What was changed: `npm audit fix` updated vulnerable dependencies within existing semver-compatible ranges, including Vite, React Router and transitive Firebase/tooling packages. A final audit reported zero vulnerabilities.

Remaining manual action: keep `npm audit` in the release checklist and review future findings before broad major-version upgrades.

## Informational

### Supabase

What was found: Supabase is not used in this repository.

What was changed: no Supabase dependency or configuration was added.

### Secrets

What was found: `.env.example` contains placeholders only. No Firebase Admin service-account JSON or private key was found in the target repo during this pass.

Remaining manual action: if any real secret exists in local `.env.local` or historical commits, rotate it without pasting it into issues, chat or logs.

### Storage

What was found: Firebase Storage config is present as a web config value, but the source code does not use Firebase Storage APIs.

What was changed: no Storage rules were added.

Remaining manual action: if Storage is introduced later, add separate tenant-isolated Storage rules before release.

### Rate limiting

What was found: this is a static client app with no API routes or Cloud Functions. Firebase Auth handles sign-in email sending, and the login page has a short resend cooldown for UX.

Remaining manual action: rely on Firebase quotas/App Check for now. Add server-side rate limiting if custom email, invite, export or API endpoints are introduced.

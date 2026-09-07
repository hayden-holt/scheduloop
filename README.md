# ScheduleLoop

ScheduleLoop is a workforce forecasting app for small businesses. It helps a gym, cafe, restaurant, or similar business turn expected demand into a practical staffing plan across the day.

## Preview

![Dashboard 1 screenshot](docs/dashboard1.png)

![Dashboard 2 screenshot](docs/dashboard2.png)

![Setup view screenshot](docs/setupView.png)


## Current MVP

ScheduleLoop currently includes:

- Firebase passwordless email-link login and membership-gated business profile storage.
- Guided onboarding for business type, roles, opening hours, and staffing assumptions.
- A dashboard showing expected staffing need across the day.
- Role-level staffing lines for areas such as front of house and kitchen.
- CSV upload for historical demand data.
- Square POS data source support through Firebase Functions, with CSV still available as the fallback.
- Basic backtesting against uploaded staff counts.
- Calendar settings for normal, quiet, busy, and event-style days.
- Labour-cost estimates based on average or role-level hourly wages.


## Why I built this

I built ScheduleLoop to practise building a realistic SaaS-style app rather than another simple to-do list or tutorial project. The idea was to create a tool that a small business manager could use to estimate staffing needs across the day based on demand, opening hours, roles, and uploaded CSV data.

The main focus was not perfect forecasting, but building a clear MVP with authentication, onboarding, stored business profiles, charts, CSV parsing, and manager-friendly recommendations.


## Tech Stack

- React 19
- Vite 7
- Firebase Authentication
- Cloud Firestore
- React Router
- Recharts
- ESLint
- Custom Node-based test runner in `scripts/run-tests.mjs`

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Fill `.env.local` with the Firebase web app config for the project. Do not commit real Firebase values.

Start the dev server:

```bash
npm run dev
```

If PowerShell blocks `npm` because of execution policy, run the same scripts through `npm.cmd`, for example:

```powershell
npm.cmd run dev
```

## Production Web Deployment

The production app target is `https://app.scheduleloop.co.uk`. The marketing
site remains separate at `https://scheduleloop.co.uk`.

Use the existing Vite app build and Firebase Hosting configuration:

```bash
npm run build
firebase deploy --only hosting
```

Deploy Firestore rules and Functions from the same app repository when their
configuration has been reviewed:

```bash
firebase deploy --only firestore:rules,firestore:indexes,functions
```

Firebase Hosting already rewrites browser refreshes and direct route requests to
`/index.html`, so app routes such as `/login`, `/onboarding`, `/rota`,
`/data-sources` and `/settings` continue to load as client routes.

Production environment values belong in the hosting and Functions runtime, not
in committed `.env.local` files. Use `.env.production.example` as the release
checklist.

## Firebase Environment Variables

The app reads these Vite variables from `.env.local`:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY=
VITE_ENABLE_SQUARE_INTEGRATION=false
```

Required at runtime:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

The remaining values should still match the Firebase web app config when available. Keep production business data out of local sample files and browser localStorage.

`VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY` is used only when Firebase App Check is configured. Add the reCAPTCHA Enterprise site key for the web app, monitor App Check metrics, then enable enforcement in the Firebase Console when production traffic is confirmed healthy.

`VITE_ENABLE_SQUARE_INTEGRATION` only controls the visible Square UI. The server-side Square integration also requires Firebase Functions secrets/configuration; see `docs/integrations/SQUARE_SETUP.md`.

## POS Integrations

Square POS is supported behind feature flags and Firebase Functions. Square OAuth, webhook ingestion, recent historical sync, token storage and disconnect all run server-side. The browser only reads safe connection metadata and calls authorised Functions.

CSV remains fully supported. If valid CSV demand history exists, ScheduleLoop keeps using it as the active forecast source and keeps Square demand separately to avoid silently double-counting overlapping history.

Setup and architecture docs:

- `docs/integrations/SQUARE_SETUP.md`
- `docs/integrations/POS_ARCHITECTURE.md`

## Available Scripts

```bash
npm run dev
```

Starts the Vite development server.

```bash
npm run build
```

Creates a production build in `dist`.

```bash
npm run lint
```

Runs ESLint across the project.

```bash
npm run test
```

Runs the lightweight Node test suite for scheduling, CSV parsing, demand confidence, and staffing helpers.

```bash
npm run preview
```

Serves the production build locally for review.

## CSV Upload Format

CSV uploads are used to replace the starter business preset with observed demand patterns.

Required:

- A time-like column named one of `time`, `timestamp`, `date`, `datetime`, `created_at`, or `created at`.
- At least one usable row inside the business opening hours.

Recommended demand columns:

- Counts such as `orders`, `transactions`, `sales_count`, `covers`, `customers`, `guests`, `bookings`, `appointments`, `check_ins`, `quantity`, or `units`.
- Money columns such as `sales`, `revenue`, or `total`.

Optional staffing history:

- A staff count column such as `staff`, `staff_count`, `team_size`, `scheduled_staff`, or `actual_staff`.

Current limits and behaviour:

- Maximum CSV size is 1 MB.
- Invalid rows and rows outside opening hours are skipped.
- If no demand column is found, each valid row counts as one demand event.
- Uploaded staff counts are used for backtesting, not as the source of the forecast.
- Example files live in `sample-data/`.

## Day Context

Day context tags let a business mark unusual calendar dates. Context is stored
on the selected date inside the business profile `dayConfigs` map and remains
optional, so older day type-only entries still work.

The Shape of Day forecast applies context as a conservative rule-based demand
multiplier before demand is converted into staff. Defaults are starting
assumptions only; future versions should learn business-specific effects by
comparing similar tagged days with similar untagged days.

## Limitations

This is still an MVP, so the forecasting model is intentionally simple. It does not connect to live weather, holiday, school term, payday, or local event APIs yet. Context tags currently adjust demand using fixed rule-based multipliers rather than learned business-specific patterns.

The app should be treated as staffing guidance, not an automatic rota system.

## Security and Data Notes

- Passwords and public self-service signup are not part of the app UI. Managers sign in with Firebase email links.
- Authentication and authorisation are separate. A signed-in Firebase user needs either an active `memberships/{uid}` document or an existing legacy self-owned profile before business data can load.
- New workspaces should be manually approved by creating a membership document with `businessId`, `role`, `status: "active"` and the manager email. Existing UID-based profiles can keep using their UID as `businessId` during migration.
- Firestore rules enforce membership checks for `businessProfiles/{businessId}` and rota subcollections. Unknown authenticated users cannot create their own workspace through the client.
- `.env.local` is ignored by Git and must not contain shared secrets in commits. Firebase web config values are public client configuration, but service-account JSON, private keys and server credentials must never be committed.
- Do not store sensitive production business data in committed sample data. The app stores only the pending email-link address and theme preference in browser storage.
- Sample CSV files should stay anonymised and synthetic.
- Privacy and terms drafts live inside the app at `/privacy` and `/terms`; complete all TODO placeholders before production.
- Manual Firebase, browser-storage, retention, recovery and incident-response steps are documented in `SECURITY_SETUP.md`, `SECURITY_REVIEW.md`, `docs/legal/DATA_PROCESSING_CHECKLIST.md`, `docs/security/BROWSER_STORAGE_AND_TRACKING.md`, `docs/security/RETENTION_AND_RECOVERY.md` and `docs/security/INCIDENT_RESPONSE.md`.

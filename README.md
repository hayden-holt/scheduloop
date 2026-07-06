# Scheduloop

Scheduloop is a workforce forecasting app for small businesses. It helps a gym, cafe, restaurant, or similar business turn expected demand into a practical staffing plan across the day.

## Preview

![Dashboard 1 screenshot](docs/dashboard1.png)

![Dashboard 2 screenshot](docs/dashboard2.png)

![Setup view screenshot](docs/setupView.png)


The current Model supports:

- Firebase sign up, login, and per-user business profile storage.
- Guided onboarding for business type, roles, opening hours, typical busy level, and peak staffing assumptions.
- A dashboard with planner and setup views.
- A "Shape of the day" chart showing total staffing need and role-level staffing lines.
- Rota guidance that turns the forecast into practical manager actions without publishing shifts.
- Optional labour-cost estimates from average or role-level hourly wages.
- CSV upload for historical demand data, role-specific demand columns, validation, and basic backtesting against uploaded staff counts.
- Calendar day settings for quiet, normal, busy, legacy event days, and manual context factors such as promotions, local events, holidays, payday periods, roadworks, and weather.
- Manager feedback on forecast accuracy for future similar days.
- Role staffing settings, opening/closing coverage rules, buffers, and break allowance settings.

Scheduloop is not a payroll system or a rota publisher yet. Labour cost is an estimate only, and forecasts should be reviewed by a manager before shifts are published.

## Why I Built This

Small businesses often make staffing decisions using guesswork, especially when demand changes by day, event, season, or local context. Scheduloop explores how a lightweight forecasting tool could help managers turn demand expectations into practical staffing guidance without needing a full payroll or rota system.


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
```

Required at runtime:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

The remaining values should still match the Firebase web app config when available. Keep production business data out of local sample files and browser localStorage.

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

## Forecasting Limitations

The forecasting model is intentionally simple and explainable for the MVP:

- Business presets provide the starter forecast until enough CSV history exists.
- CSV data is blended with preset demand, with more trust given to matching weekday history.
- Calendar day type and context settings adjust demand with fixed rule-based multipliers.
- Staffing is calculated from demand, role curves, service rates, peak staffing caps, minimum cover rules, and operating buffers.
- Confidence reflects the amount of matching uploaded history; it is not a guarantee.
- Manual context tags exist, but no external weather, holiday, payday, school term, roadworks, or local event APIs are connected yet.
- The model does not currently learn business-specific context effects.

Managers should keep reviewing forecasts against real rotas and trading patterns before relying on the output for staffing decisions.

## Security and Data Notes

- Business profiles are stored in Firestore under the signed-in user's UID.
- Firestore rules should continue to enforce ownership checks before profile reads or writes.
- `.env.local` is ignored by Git and must not contain shared secrets in commits.
- Do not store sensitive production business data in localStorage or committed sample data.
- Sample CSV files should stay anonymised and synthetic.


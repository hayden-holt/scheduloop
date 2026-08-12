# ScheduleLoop Data Processing Checklist

Status: draft for owner/legal review.

## Data categories

- Manager account email and Firebase authentication metadata.
- Workspace membership, role and access status.
- Business profile details: name, location, business type, subtype, opening hours, customer pattern and operating assumptions.
- Staffing roles, role productivity assumptions, wage/cost inputs and labour-cost estimates.
- Employee records used for rota planning, currently names, default role, hourly rate and active status.
- Shifts, rota week status, copied-week analysis and printable rota summaries.
- CSV-uploaded historical demand or trading data, including optional staff-count history.
- POS operational transaction summaries from connected providers such as Square: timestamps, location IDs, transaction counts, item counts, sales totals, statuses and external IDs used for deduplication.
- Forecast feedback, calendar day settings, context tags and backtesting summaries.
- Technical/security metadata needed by Firebase, Firestore and App Check.

## Systems and processors to confirm

- Firebase Authentication.
- Cloud Firestore.
- Firebase App Check with reCAPTCHA Enterprise.
- Firebase Hosting if used for deployment.
- Firebase Cloud Functions for Square OAuth, webhooks, historical sync and token handling.
- Square, when a customer chooses to connect Square POS.
- TODO: confirm production hosting if not Firebase Hosting.
- TODO: confirm support, email, monitoring, analytics or backup tools before launch.

## Controller/processor questions

- Confirm whether the customer business is controller for employee/workforce data it enters into ScheduleLoop.
- Confirm whether ScheduleLoop acts as processor for employee/workforce data and independent controller for its own account/security data.
- Confirm the final contracting party, privacy contact and DPA signing process.
- Do not publish final controller/processor claims until reviewed.

## Security measures in this pass

- Firebase email-link sign-in replaces password UI.
- Client cannot write membership documents.
- Firestore rules require membership or legacy ownership before reading business data.
- Business, employee, shift and rota-week writes must match the path `businessId`.
- CSV uploads have size, type, row, column, duplicate-header, cell-length and formula-like value checks.
- App Check is integrated behind an environment variable and must be enforced after monitoring.
- Security headers are configured for Firebase Hosting.
- Square tokens are intended to be encrypted and stored in server-only Firestore collections.
- Firestore rules deny client writes to POS transactions, POS demand buckets and server-only integration collections.
- Square webhook ingestion verifies signatures before processing events.

## Deletion and return process to define

- Manager access removal: set `memberships/{uid}.status` away from `active`, then review whether the Firebase user should be disabled or deleted.
- Employee removal: use in-app deactivation for rota continuity; define when permanent deletion is required.
- Workspace deletion: must be privileged, explicitly confirmed and include profile data plus subcollections.
- CSV data removal: clear `csvDemand` from the business profile and confirm derived forecasts/backtests are no longer retained.
- POS disconnect: revoke/delete stored provider credentials where possible and preserve historical ScheduleLoop demand unless the customer explicitly requests deletion through a defined workflow.
- Export/access requests: define what data can be exported from Firestore and how identity/authority will be verified.

## Retention placeholders

- TODO: manager account retention.
- TODO: inactive workspace retention.
- TODO: employee/rota history retention.
- TODO: CSV upload/model retention.
- TODO: raw normalised POS transaction retention after aggregation.
- TODO: POS demand bucket retention.
- TODO: support request retention.
- TODO: backup retention once backups are configured.

## International transfer placeholders

- TODO: confirm Firebase/Google Cloud region and subprocessors.
- TODO: confirm whether customer data may be processed outside the UK/EEA.
- TODO: document transfer safeguards with legal support.

## Future DPA items

- Parties and roles.
- Subject matter and duration.
- Categories of data subjects and personal data.
- Processing instructions.
- Subprocessor approval and notice.
- Security measures.
- Assistance with rights requests and breach assessment.
- Return/deletion on termination.
- Audit and information rights.

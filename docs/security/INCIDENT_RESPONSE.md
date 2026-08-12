# ScheduleLoop Incident Response

Use this checklist for suspected security or privacy incidents. Reportability depends on the facts and must be assessed; not every incident is automatically reportable.

## 1. Identify and contain

- Record the date, time, reporter and short summary.
- Identify affected systems: Firebase Auth, Firestore, App Check, hosting, local development machine or GitHub.
- If active misuse is suspected, disable affected memberships or Firebase users.
- If a secret may be exposed, revoke or rotate it immediately.
- Avoid deleting evidence while containment is in progress.

## 2. Preserve evidence

- Save relevant Firebase audit logs, Auth events, Firestore activity, hosting logs and GitHub commit history.
- Record affected user IDs, business IDs and document paths without copying unnecessary personal data.
- Keep a timeline of actions taken.
- Store evidence somewhere access-controlled.

## 3. Assess impact

- Identify affected organisations/workspaces.
- Identify data categories involved: manager account, employee/rota, CSV demand data, forecasts, settings or technical metadata.
- Check whether data was read, changed, deleted or only potentially exposed.
- Confirm whether the incident crosses tenants.
- Decide whether external legal/privacy advice is needed.

## 4. Communicate and escalate

- Notify Hayden/product owner immediately.
- Contact affected customers if required by the assessment.
- Review whether the ICO or another regulator must be notified.
- Do not make unsupported promises about scope, cause or resolution.
- Keep customer messages factual and action-oriented.

## 5. Recover

- Redeploy fixed Firestore rules or application code.
- Restore data from backup only after confirming the restore point is clean.
- Re-enable users or memberships only after the issue is fixed.
- Validate with tests for signed-out access, wrong-tenant access and write spoofing.

## 6. Review

- Document root cause.
- Document customer and data impact.
- List credentials rotated.
- Add or update tests and monitoring.
- Update `SECURITY_REVIEW.md` if the incident reveals a new known risk.

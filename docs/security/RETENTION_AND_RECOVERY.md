# ScheduleLoop Retention and Recovery Notes

Status: draft operational guidance. Do not automatically delete production data until retention periods and customer terms are confirmed.

## Data locations

- `memberships/{uid}`: manager workspace access and role.
- `businessProfiles/{businessId}`: business profile, forecasting settings, CSV demand model, day settings and feedback.
- `businessProfiles/{businessId}/employees`: rota employee records.
- `businessProfiles/{businessId}/shifts`: rota shifts.
- `businessProfiles/{businessId}/rotaWeeks`: rota week status.
- Firebase Authentication: manager Firebase users and email-link auth metadata.

## Retention placeholders

- Active customer workspace: retain while the customer uses ScheduleLoop.
- Inactive workspace: TODO decide review period before deletion.
- Employee records: retain while needed for rota history, support, legal or customer requirements.
- CSV demand models: retain while needed for forecasting/backtesting, unless the customer asks for removal.
- Firebase users/memberships: remove or disable when a manager leaves or a customer contract ends.
- Backups: TODO define once Firestore backup configuration is enabled.

## Deletion controls

- Manager removal: disable membership first, then decide whether to disable/delete the Firebase user.
- Employee removal: prefer deactivation while shifts reference the employee; permanent deletion needs a rota-history decision.
- Workspace deletion: must require owner/admin approval and explicit confirmation. Delete profile data and subcollections together.
- CSV removal: clear the stored `csvDemand` field from the business profile.

## Backup and recovery

- Current source state: no custom backup system is implemented in this repository.
- Recommended approach: enable managed Firestore scheduled backups or Google Cloud export for production.
- Store backups in an access-controlled Google Cloud location.
- Test restoring to a non-production Firebase project before relying on backups.
- Document who can approve restores and how accidental deletion will be triaged.

## Known gaps

- No automated cascading workspace deletion is implemented yet.
- No self-service data export portal is implemented yet.
- No production backup schedule is defined in source; it must be configured in Firebase/Google Cloud.

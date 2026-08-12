# ScheduleLoop Security Setup

This checklist covers the Firebase Console and deployment steps that cannot be completed safely from source code alone. Complete it before enabling production traffic.

## 1. Confirm the Firebase project

1. Open the Firebase Console.
2. Select the ScheduleLoop production project.
3. Confirm the web app config matches `.env.local`.
4. Do not place service-account JSON, private keys or Admin SDK credentials in any `VITE_` variable.

## 2. Enable email-link sign-in

1. Go to Authentication > Sign-in method.
2. Open Email/Password.
3. Enable Email link sign-in.
4. Do not rely on password UI; the app no longer exposes password login, signup, reset or password-change screens.
5. Keep the provider configuration compatible with Firebase email-link authentication.

## 3. Lock down authorised domains

1. Go to Authentication > Settings > Authorized domains.
2. Keep only legitimate ScheduleLoop app domains, local development domains needed for testing, and Firebase-required domains.
3. Remove unknown or stale domains.
4. Test a sign-in link from each domain that will be used in production.

## 4. Configure the email template

1. Go to Authentication > Templates.
2. Edit the passwordless sign-in email.
3. Use ScheduleLoop branding and a clear subject such as "Sign in to ScheduleLoop".
4. Do not include secrets, internal project IDs beyond what Firebase requires, or customer lists.
5. Optional later step: configure a custom sending domain if Firebase supports it for the selected plan and project.

## 5. Create workspace memberships

Each authorised manager must have a Firestore document:

```text
memberships/{firebaseUid}
```

Recommended fields:

```json
{
  "businessId": "existing-business-profile-id-or-new-workspace-id",
  "email": "manager@example.com",
  "role": "owner",
  "status": "active",
  "createdAt": "server timestamp"
}
```

Allowed app roles are `owner`, `admin`, `manager` and `employee`. Only `owner`, `admin` and `manager` can write business data. Set `status` to something other than `active` to block access.

For existing accounts, use the existing `businessProfiles/{uid}` document ID as `businessId` unless you intentionally migrate the data.

## 6. Deploy Firestore rules

1. Review `firestore.rules`.
2. Run the local tests.
3. Deploy rules with the Firebase CLI from this repository:

```bash
firebase deploy --only firestore:rules
```

4. Test these cases:
   - Signed-out user cannot read business data.
   - Unknown signed-in user cannot create a workspace.
   - Manager A cannot read or write Manager B's `businessProfiles/{businessId}` path.
   - A manager cannot write a document whose `businessId` differs from the path.

## 7. Register Firebase App Check

1. Go to App Check in Firebase Console.
2. Register the ScheduleLoop web app.
3. Choose reCAPTCHA Enterprise.
4. Add the site key to hosting/runtime configuration as:

```env
VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY=
```

5. Deploy the app with App Check code enabled.
6. Watch App Check metrics first.
7. Enable enforcement for Firestore only after legitimate production and staging traffic is passing.

## 8. Deploy security headers

`firebase.json` includes Firebase Hosting headers for CSP, HSTS, frame protection, MIME sniffing, referrer policy and permissions policy. If hosting somewhere else, copy equivalent headers into that platform.

Test sign-in, Firestore reads/writes, charts and App Check after deploying CSP. If reCAPTCHA or Firebase requests fail, adjust the allowlist rather than replacing it with a wildcard.

## 9. Environment and secrets

1. Keep `.env.local` local.
2. Keep `.env.example` placeholder-only.
3. Rotate any real secret that was ever committed to Git history. This pass did not find committed service-account JSON or Admin SDK private keys in the target repo.
4. Add budget and usage alerts in Firebase/Google Cloud for Auth, Firestore and App Check.

## 10. Privacy and legal launch steps

1. Complete all TODO placeholders in `/privacy` and `/terms`.
2. Review `docs/legal/DATA_PROCESSING_CHECKLIST.md`.
3. Confirm controller/processor position, retention periods, contact details, lawful basis wording, ICO status and any DPA requirements.
4. Do not present the draft legal pages as final until reviewed.

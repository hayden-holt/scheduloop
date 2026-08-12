# ScheduleLoop Browser Storage and Tracking Record

Status: technical record for privacy review.

## Browser storage used by the app

- Firebase Auth uses its normal browser persistence for the signed-in manager session.
- `scheduloop.emailForSignIn` in `localStorage` stores the pending email-link address so same-device sign-in can complete.
- `scheduloop.theme` in `localStorage` stores the light/dark theme preference.
- No app-specific `sessionStorage` usage was found.

## Cookies

- The source code does not set application cookies.
- Firebase, reCAPTCHA Enterprise or the hosting platform may set necessary security/session cookies as part of their services. Confirm this in the deployed environment.

## Analytics and tracking

- No analytics SDK, tracking pixel or third-party marketing embed was found in the source code.
- Firebase Analytics is not initialized in `src/firebase.js`.
- No cookie banner was added because no optional analytics/tracking storage is currently implemented.

## Third-party browser resources

- Firebase web SDK bundle.
- Firebase Auth and Firestore network calls.
- Firebase App Check with reCAPTCHA Enterprise when configured.

## Review triggers

Update this record if ScheduleLoop adds analytics, product monitoring, support chat, embedded calendars, payment tools, export tools or any non-essential browser storage.

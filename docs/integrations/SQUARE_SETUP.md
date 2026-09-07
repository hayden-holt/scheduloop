# Square POS Setup

Production project: `scheduloop-96f9a`. Production Square application: `sq0idp--KPNTptFv5a-oipf1D35hg`.

Keep `VITE_ENABLE_SQUARE_INTEGRATION=false` until deployed backend, OAuth callback and signed webhook delivery have been verified. Do not put secrets in source, chat, Git, Vite variables or environment files. The backend uses Firebase Functions Secret Manager bindings.

## Production configuration

The ignored file `functions/.env.scheduloop-96f9a` contains non-secret settings only:

```env
ENABLE_SQUARE_INTEGRATION=true
APP_BASE_URL=https://app.scheduleloop.co.uk
SQUARE_ENVIRONMENT=production
SQUARE_APPLICATION_ID=sq0idp--KPNTptFv5a-oipf1D35hg
SQUARE_REDIRECT_URI=https://us-central1-scheduloop-96f9a.cloudfunctions.net/squareOAuthCallback
SQUARE_WEBHOOK_NOTIFICATION_URL=https://us-central1-scheduloop-96f9a.cloudfunctions.net/squareWebhook
```

These are expected deployment URLs; they are not evidence that the endpoints are live. Preserve the existing Firebase project and Hosting configuration. Do not run `firebase init`.

## Secret entry and deployment order

1. In Square Developer Dashboard select this application and **Production**. Register the exact OAuth redirect URI above.
2. From the repository root run the command below and enter the production application secret only into Firebase's interactive secret prompt. Enable Secret Manager if Firebase requests it. Never include the value as a command argument.

   ```sh
   firebase functions:secrets:set SQUARE_APPLICATION_SECRET --project scheduloop-96f9a
   ```

3. Generate a cryptographically random 32-byte key locally and pass its base64 representation directly into Secret Manager as `SQUARE_TOKEN_ENCRYPTION_KEY`, without displaying it or saving it in a file. Keep this key stable; rotating it without re-encrypting stored tokens breaks existing connections.
4. Create a Production webhook subscription with the exact notification URL above and events `payment.created`, `payment.updated`, `refund.created`, `refund.updated`. Use API version `2026-07-15`. Store its signature key through the interactive command below. If Square requires an already reachable endpoint before subscription creation, deploy the OAuth/callable functions first and complete the webhook deployment after the key exists.

   ```sh
   firebase functions:secrets:set SQUARE_WEBHOOK_SIGNATURE_KEY --project scheduloop-96f9a
   ```

5. Deploy only the five Square functions and the reviewed Firestore rules. Do not deploy Hosting or enable the public frontend flag at this stage.

   ```sh
   firebase deploy --only functions:createSquareOAuthUrl,functions:squareOAuthCallback,functions:disconnectSquare,functions:syncSquareHistory,functions:squareWebhook,firestore:rules --project scheduloop-96f9a
   ```

6. Verify the actual deployed URLs. Confirm missing/invalid webhook signatures are rejected and invalid/replayed OAuth state is rejected. With an authorised owner/manager test session, invoke the existing callables or use a local test frontend to complete OAuth while the public frontend flag remains false. Confirm the correct merchant/business mapping, encrypted server-only tokens, a small history sync, and a valid signed payment/refund webhook. Retry the same event and check there is no duplicate revenue. Verify disconnect revokes the grant, removes credentials and stops ingestion while preserving history.
7. Only after these live checks pass should a separate frontend release enable `VITE_ENABLE_SQUARE_INTEGRATION=true`.

All five functions bind `SQUARE_APPLICATION_SECRET` and `SQUARE_TOKEN_ENCRYPTION_KEY`; the webhook additionally binds `SQUARE_WEBHOOK_SIGNATURE_KEY`. Application ID and URLs are public configuration, not secrets. Never inspect or print secret versions to check setup; inspect secret names and binding metadata instead.

## Permissions and isolation

OAuth requests only `MERCHANT_PROFILE_READ` and `PAYMENTS_READ`. No payment/refund write or customer-contact scope is requested. Membership is checked both when claiming OAuth state and after the token exchange. State consumption and credential/mapping persistence use transactions; business operations use expiring leases with stale-worker write checks.

A Square merchant remains reserved to its original ScheduleLoop business after disconnect. Moving a merchant to another business needs a deliberate data migration; OAuth cannot perform that transfer. Finish disconnect before connecting a different merchant to the same business.

## Refresh, retries and disconnect

Tokens refresh on webhook/sync use when less than 23 days remain, approximately weekly for normal 30-day tokens. This is on-use renewal, not a scheduled job. Failed renewal preserves encrypted credentials for retry and never returns an expired token.

Webhook completion is recorded only after ingestion and model updates succeed. Retries can repair partial work without counting a payment twice. Refund events resolve `refund.payment_id`, then retrieve the authoritative payment. Older payment updates cannot replace newer transaction totals. Seller timezone conversion happens at the Square ingestion boundary; existing forecasting calculations remain unchanged.

Disconnect disables routing before remote revocation and deletes credentials after successful revocation. If Square revocation fails, encrypted credentials remain marked `revocationPending`; reconnect and ingestion are blocked. Retry the authenticated `disconnectSquare` callable for the same business to finish cleanup. Historical demand data remains intact.

History sync rejects a result exceeding 20 pages instead of claiming an incomplete import succeeded. Model rebuilding rejects more than 5,000 transaction records instead of silently truncating. Larger histories require a separately reviewed batching change.

## Local verification

Use Node.js 22.17+ for the focused tests, which use Node's experimental module mocking to exercise the actual handlers with simulated Firebase and Square responses:

```sh
npm run lint
npm test
npm run build
npm --prefix functions run lint
npm --prefix functions test
```

These are local checks, not a live Square test or Firestore emulator verification. The existing deployment runtime remains Node.js 20 as configured in `firebase.json`; plan its upgrade before Google's 30 October 2026 decommission date. Do not alter Hosting or runtime configuration as part of secret setup.

For sandbox testing use a separate Firebase test project, Square Sandbox credentials and matching emulator URLs/configuration. Do not switch the production project to sandbox. Confirm the exact notification URL is used for signature verification and never log provider response bodies, tokens or secrets.

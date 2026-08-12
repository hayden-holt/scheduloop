# Square POS Setup

This guide explains the manual setup needed before ScheduleLoop can sync Square POS transactions.

Do not put real Square secrets in Git. Use Firebase Functions secret/config management for server-side values and `.env.local` only for local development.

## Development / Sandbox

1. Create or open a Square Developer account.
2. Create a Square application for ScheduleLoop.
3. Use the Sandbox credentials first.
4. Set the OAuth redirect URL to the deployed or emulated `squareOAuthCallback` Function URL.
5. Set the webhook notification URL to the deployed or emulated `squareWebhook` Function URL.
6. Subscribe the webhook to Square payment events that cover created, updated, completed, canceled and refunded payments.
7. Copy the webhook signature key into Firebase Functions secrets.
8. Create a Firebase test workspace and membership for the manager account.
9. Enable the frontend flag with `VITE_ENABLE_SQUARE_INTEGRATION=true`.
10. Enable the backend flag with `ENABLE_SQUARE_INTEGRATION=true`.
11. Connect Square from `/data-sources`.
12. Run a sandbox payment and confirm the connection shows recent sync/webhook timestamps.

## Required Square Permissions

ScheduleLoop only needs read-only operational data:

- `MERCHANT_PROFILE_READ`
- `PAYMENTS_READ`

Do not request payment write, refund, card-on-file or customer-contact scopes unless a future feature genuinely needs them.

## Firebase Functions Configuration

Set these values for the Functions runtime:

```env
ENABLE_SQUARE_INTEGRATION=true
APP_BASE_URL=https://your-scheduloop-app.example
SQUARE_ENVIRONMENT=sandbox
SQUARE_APPLICATION_ID=your_square_application_id
SQUARE_APPLICATION_SECRET=your_square_application_secret
SQUARE_REDIRECT_URI=https://your-region-your-project.cloudfunctions.net/squareOAuthCallback
SQUARE_WEBHOOK_NOTIFICATION_URL=https://your-region-your-project.cloudfunctions.net/squareWebhook
SQUARE_WEBHOOK_SIGNATURE_KEY=your_square_webhook_signature_key
SQUARE_TOKEN_ENCRYPTION_KEY=generate_a_32_byte_base64_key
```

Generate `SQUARE_TOKEN_ENCRYPTION_KEY` as a 32-byte base64 value, for example with a trusted local secret generator. Store it as a secret and keep it stable, because it is used to decrypt existing Square tokens.

## Production

1. Repeat the setup with Square production credentials.
2. Change `SQUARE_ENVIRONMENT=production`.
3. Use the production app URL in `APP_BASE_URL`.
4. Use the production Function URLs for OAuth and webhooks.
5. Confirm authorised ScheduleLoop domains in Firebase Auth and Square.
6. Test with a low-risk production seller before wider rollout.
7. Keep `VITE_ENABLE_SQUARE_INTEGRATION=false` until the backend, webhook URL and secrets are deployed.

## Disconnecting Square

Managers can disconnect from `/data-sources`. ScheduleLoop deletes stored Square credentials where possible and marks the connection disconnected. Historical ScheduleLoop demand data is preserved unless a future explicit deletion workflow is added.

## Troubleshooting

- Check Firebase Functions logs for provider, business ID, event type, event ID and processing duration.
- Do not log or share Square access tokens, refresh tokens, webhook secrets or card data.
- If webhooks fail, confirm the exact webhook notification URL matches `SQUARE_WEBHOOK_NOTIFICATION_URL`.
- If historical sync stops, confirm the Square connection is still authorised and the backend flag is enabled.

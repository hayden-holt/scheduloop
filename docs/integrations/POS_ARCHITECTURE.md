# POS Integration Architecture

ScheduleLoop keeps one forecasting pipeline. CSV uploads and POS providers both become common demand records before the Shape of Day, forecast, staffing and rota logic run.

```text
CSV Upload
    |
Square POS ---- Future POS providers
    |
Normalisation
    |
Demand buckets
    |
ScheduleLoop demand model
    |
Shape of Day
    |
Forecast
    |
Staffing requirements
```

## Provider-Neutral Layer

The POS code is split into provider-neutral helpers and Square-specific code:

- `functions/src/pos/config.js` defines provider IDs, statuses and Square runtime config.
- `functions/src/pos/normaliseSquare.js` turns Square payments into a minimal ScheduleLoop transaction shape.
- `functions/src/pos/demandAggregation.js` aggregates normalised transactions into the same interval-based demand model used by forecasting.
- `functions/src/index.js` exposes Firebase Functions for OAuth, webhook ingestion, historical sync and disconnect.
- `src/integrations/pos/*` contains frontend-safe helpers for status display and callable Functions.

A future provider such as Lightspeed should add a `normaliseLightspeed` module that outputs the same normalised transaction fields, then reuse the same bucket aggregation and demand model.

## Data Model

Safe client-readable metadata lives under:

- `businessProfiles/{businessId}/posConnections/{provider}`
- `businessProfiles/{businessId}/demandBuckets/{source_date_slot}`

Normalised transaction records live under:

- `businessProfiles/{businessId}/posTransactions/{source_externalTransactionId}`

Server-only collections live at the root:

- `posSecrets/{businessId_provider}` for encrypted access and refresh tokens.
- `posMerchantMappings/{provider_merchantId}` for webhook routing.
- `posWebhookEvents/{provider_eventId}` for webhook idempotency.
- `squareOAuthStates/{stateHash}` for short-lived OAuth state validation.

The browser can read safe connection metadata for its own workspace. It cannot create Square transactions, demand buckets, webhook events, merchant mappings or token documents.

## Normalised Transaction Fields

Normalised transactions intentionally avoid payment-card and customer identity data:

- `businessId`
- `locationId`
- `source`
- `externalMerchantId`
- `externalLocationId`
- `externalTransactionId`
- `externalOrderId`
- `timestamp`
- `status`
- `transactionCount`
- `revenue`
- `refundedRevenue`
- `itemCount`
- `currency`

## Deduplication And Updates

Webhook and backfill ingestion use stable Square event/payment IDs. A fingerprint of the operational fields prevents duplicate counting. If a payment is updated, refunded or canceled, the old bucket contribution is reversed or adjusted before the new value is applied.

CSV and POS history can overlap. The frontend currently prefers an existing valid CSV demand model for forecasting and keeps Square demand separately as `posDemand`. This avoids silently double-counting overlapping history. Managers can use Square-only forecasting when there is no valid CSV model.

## Historical Backfill

Backfill is server-side, defaults to 30 days and is capped at 90 days. It paginates Square payments with a page cap to avoid unbounded sync jobs. Imported payments are normalised, deduplicated and aggregated into demand buckets.

## Live Actuals

`calculateActualDemandSoFar` provides the underlying actual-vs-forecast calculation for live reporting. It is not wired to automatically edit rota shifts or change today's Shape of Day. Any future live adjustment feature should remain manager-controlled.

## Security

- Square OAuth tokens are encrypted and stored in a server-only collection.
- OAuth state is short-lived and validated on callback.
- Square webhooks are verified with the Square signature key and exact notification URL.
- Firebase callable Functions re-check workspace membership before connect, sync or disconnect.
- Firestore rules deny client writes to POS transactions, demand buckets and all server-only collections.
- Logs should include provider, business ID, event type, event ID and duration, but never tokens, webhook secrets, card data or unnecessary customer details.

## Firestore Cost Notes

Live ingestion writes one normalised transaction and one targeted demand bucket update per new or changed transaction. Historical sync rebuilds the aggregate demand model once after the sync completes. The dashboard should read aggregate demand models and connection metadata, not thousands of raw transactions.

# Performance follow-up — items 2 and 3 only

## Scope

This release reduces sync/cache work and initial page-code/inventory loading.
It does not change database schema, authentication, stock RPCs, audit retention,
or database-size monitoring. No production stock transactions were run as tests.

## Sync and cache

- Reuse the product metadata snapshot during change detection rather than
  serialize every product a second time.
- Clearing acknowledged dirty operations snapshots/persists only affected
  products, not the entire catalog. A delayed acknowledgement still retains a
  newer local edit. In the 2,867-product regression, one acknowledgement serializes
  only that product before and after persistence.
- Incremental IndexedDB writes compare queued row/dirty fingerprints after prior
  writes finish. Repeated identical acknowledgements do not open write
  transactions. Fingerprints advance only after successful persistence, so failed
  writes remain retryable. Product rows and their dirty ledger remain atomic.
- Keep the commit-safe full `id,revision` manifest reconciliation. Product details
  are downloaded only when revisions differ; no unsafe change-id/timestamp cursor
  was reintroduced. The manifest itself is still a full, small catalog scan.

## Page code

The static build extracts 39 render/form functions into four versioned classic
script chunks (24 routes), loaded once per group on demand:

- Reports: product/bill/profit/tax/inventory/movement/low-stock/expiry reports.
- Documents: cash bills, tax invoices, quotations, orders, receipts, returns,
  exchanges and their forms.
- Settings: business/system/user settings, AUDIT LOG and warehouses.
- Catalog: products, contacts/customer pricing and promotions.

The editable source remains together in `app.js` to preserve legacy shared scope
and existing source-level tests; actual production assets are split. Shared
business logic, POS and mobile tools remain in the main asset.

Measured minified main asset before this release: 1,242,726 bytes. New main asset
is about 1,070,000 bytes (about 14% less, before transport compression); deferred
chunks total about 180 KB. This is a download/parse reduction, not a measured
14% improvement in overall transaction latency.

Failed loads expose retry/reload controls. Navigation ownership prevents a late
load from replacing a newer page. Chunks check the app version before installing
exports, preventing mixed releases. The existing service worker caches fetched
chunks; the first visit to an uncached group requires internet. They are not
precached at startup, since that would negate the deferred-download benefit.

## Inventory

- Following checkout, sale cancellation, receipt application and supplier return,
  fetch balances and positive LOTs only for the document's product/warehouse scope.
- Product filters are applied at Supabase in batches of at most 200 IDs. An empty
  product scope performs no query and cannot accidentally become a full load.
- Replace only requested rows. Exhausted LOTs disappear without deleting other
  products/warehouses from the cache. A partial load never marks a warehouse as
  fully loaded. LOT pagination has an additional unique ID tie-breaker.
- Serialize reads per inventory table to prevent an older full read overwriting
  a later targeted read; ignore results invalidated by session/cache reset.
- Read failure preserves existing rows and warns that the committed transaction
  succeeded but the stock display needs refreshing, rather than inviting another
  transaction.

Initial loads, warehouse-wide reports, manual refreshes and remaining adjustment
flows still use full warehouse reads when a complete picture is necessary. This
release does not claim a realtime or delta-only inventory feed across devices.

## Verification

- Static/Node regression suite, including targeted row replacement, exhausted
  LOTs, empty scope, 405-ID batching, read ordering, reset invalidation and
  acknowledgement races.
- All 15 browser-test files, including a test against actual built assets for all
  24 deferred routes, retry, navigation during delayed loading, version mismatch,
  real IndexedDB no-op writes and disk-failure retry.
- Existing stock/idempotency/revision/late-commit regressions remain enabled.
- Read-only production query confirmed the scoped balance/LOT projections and
  revision manifest query are accepted. No data was changed by verification.

The deferred staging multi-device acceptance tests and monitoring/archive work
remain outside this release, as requested.

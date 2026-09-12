# Reliability fixes and storage plan — 12 September 2026

## Implemented

- Two database RPCs now raise `PT409` for permanent revision conflicts, rather than the retryable SQLSTATE `40001`. Authentication, owner checks, revision checks and existing grants remain in place. Document conflicts pause automatic retries until an explicit retry or changed payload.
- Stock/document request IDs are committed to IndexedDB before the RPC. Checkout additionally preserves its exact original payload and cart snapshot. A local persistence failure stops submission. Lost responses retain the original ID; definitive database rejections and network failures are distinguished.
- Legacy localStorage operation IDs migrate without losing identity. Completion markers prevent a stale localStorage key from being reused if storage is full.
- Pending contact, representative and document creates/edits/deletions retain their original revision baseline. Server refresh cannot silently acknowledge or overwrite them. A per-user, per-record IndexedDB outbox preserves unrelated work from multiple tabs; concurrent changes to the same pending record stop instead of overwriting it. The sync details dialog offers export and explicit server-version selection.
- Customer/supplier codes are allocated by a private database sequence. A case-insensitive unique index protects automatically generated and manually entered codes. Existing codes were not renumbered. Sequence gaps after aborted inserts are normal.
- Customer selection uses 60 rows per page, three columns, searches the entire in-memory customer list, and normalizes phone-number punctuation. It does not fetch all purchase histories to display the picker.
- Clean document cache is bounded to 100 records per table, plus every pending record. Product and sales-history arrays are excluded from this workspace snapshot; products retain their separate IndexedDB cache.
- Two logo assets were losslessly converted to WebP. Original PNG source artwork remains in the repository, but only WebP is deployed. Decoded RGBA buffers were compared byte-for-byte: no change to pixels, dimensions or print appearance. Combined payload: 1,853,856 → 1,356,598 bytes, about 26.8% smaller.
- Service-worker runtime cache is limited to 80 non-shell entries, accepts only application assets/approved CDN packages, and deletes only this application's old cache versions. Offline shell/logo assets are protected from runtime eviction.
- The retired `purchaseorder2`/`po2` UI, state, routes, handlers, obsolete styles and prefix setting were removed. `purchase_orders_full` is retained solely as historical database data and a read-only backup/restore compatibility field. No historical business records were deleted.

## Verification recorded during this change

- Final test coverage: 150 static/behavioral tests and 22 browser test files; production build succeeds. Local and live migration versions match exactly across 77 migrations. The two new live versions are `20260912084207` and `20260912085150`.
- Live database: custom `40001` in public/private function bodies = 0; targeted requests older than two minutes = 0. No backend termination or whole-project restart was needed.
- `operation_ledger` insert counter remained 3,824,866 on subsequent checks; dead-row estimate = 0. This is an observed interval, not a promise that future requests can never stall.
- Rollback-only database checks verified distinct generated contact codes, rejection of a case-insensitive duplicate, and `PT409` for stale mobile product revision. No test contacts remained. Sequence numbers consumed by rolled-back tests are intentionally not reused.
- Static/behavioral checks cover pending edits/deletes, original revision baselines, legacy cache reconciliation, cache limits, acknowledgement races, conflict pause, old-UI removal and cache allowlisting.
- Browser checks cover full localStorage, IndexedDB failure before submission, response-loss/reload retry, concurrent request-ID creation, multiple-tab outbox preservation, same-record conflict blocking, checkout payload recovery, 5,000-customer paging and formatted phone search. Existing POS/quotation/payment, label, customer, document and lazy-page tests are retained.
- Supabase Performance Advisor: no warnings/errors at verification; unused-index items are informational and were not blindly removed. Security Advisor still reports intentional callable security-definer RPCs and disabled leaked-password protection; this change does not claim the security advisor is clear. See [security-definer review guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Operating instructions

1. If a record conflicts, open sync details and download its pending-work copy before choosing the server version. That choice discards only the selected local edit; it does not alter stock.
2. If local persistence fails, keep the tab open, free space/allow website storage, and retry. Do not clear website data, use a private browsing session for business work, or force-close a tab with unsaved-work warnings. Browser eviction or manual deletion of all site data cannot be made recoverable by an in-browser cache alone.
3. Resolve pending checkout/stock results before recreating a transaction. Do not delete an idempotency ledger merely to reduce database size.
4. The outbox is not a full offline sales mode. Operations requiring server validation still require connectivity; notes/settings retain their separate existing save flows.

## Long-term capacity plan (not scheduled automatically)

| Area | Policy / next check |
| --- | --- |
| Audit and print history | Keep the existing 7-year policy. Monitor monthly growth and verify retention jobs. An archive in the same database still occupies database space. |
| Sync diagnostics | Keep the existing 180-day retention and deduplication. Investigate repeated failures rather than only deleting logs. |
| Scheduler run history | Keep the existing 30-day cleanup; check failed runs and retention results. |
| Idempotency ledgers | No automatic purge added. Before introducing retention, define a retry horizon and permanent compact deduplication tombstones; test retries older than that horizon. |
| Browser outbox | Never evict pending entries to meet a cache budget. Export and reconcile conflicts. Clean cached documents may be evicted; pending work may not. |
| Database growth | Record total/table/index sizes weekly; investigate a >20% week-on-week increase or sustained high usage against the actual plan quota. Revisit thresholds after a month of real traffic. |
| Unused indexes | Observe at least a representative business cycle and review FK, uniqueness and report needs before dropping. A freshly reset usage counter is not proof an index is unnecessary. |
| Backups | Keep encrypted off-device backups with restricted access. Run the existing restore drill against an isolated target regularly and after schema changes; never test a destructive restore on production. |
| Old purchase-order history | Keep read-only until the owner explicitly approves data retirement and a verified archive/restore test exists. |

## Follow-up boundaries

No audit-history purge, stock adjustment, completed-sale deletion, production restore, recurring automation, plan upgrade or auth-policy change was performed as part of this work. These need their own operational decision, not an assumption that all old data is disposable.

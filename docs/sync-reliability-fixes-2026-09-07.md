# Sync reliability fixes — 2026-09-07

Addresses findings 1–6 in the September 7 system audit. No database migration,
stock adjustment, retention change, or data deletion is part of this release.

## Changes

1. Master data, products and documents send detached payloads. Only acknowledged
   payloads become the sync baseline; edits during a request remain pending.
   Successful members of revision-guarded batches are acknowledged independently.
2. A remote deletion no longer turns a pending product update into an insert.
   The existing revision-conflict UI allows an explicitly confirmed discard of
   the local copy if the server product no longer exists.
3. Product refresh reconciles authoritative `id,revision` pairs using keyset
   pagination, fetching full details only for changed products. Cache version 6
   invalidates the unsafe sequence-cursor baseline. It does not assume identity
   allocation order equals commit order or rely on the change-log retention window.
4. IndexedDB connections close on versionchange; blocked upgrades display an
   actionable notice and time out. Startup/login stop after a cache-open timeout
   to avoid overwriting pending local data with an unhydrated cache.
5. Pending diagnostics use one localStorage key per event. Acknowledgement removes
   only that key. The old array is migrated before removal; rejected events remain
   queued without preventing attempts for other events. The existing 100-event
   cap remains; this queue is diagnostic history, not a stock transaction ledger.
6. Required recovery setup enforces the same four-character answer minimum as the
   server. Its modal also appears above login/warehouse-selection screens.

## Verification

- 112 static/Node tests passed, including 13 new behavioral race regressions.
- Existing 13 browser-test files passed; recovery form was rerun after extending
   the test to reject three characters and submit four characters.
- New cache-upgrade browser test passed with real shared-origin IndexedDB:
   an old connection blocks upgrade, closing it resumes upgrade, and the next
   versionchange automatically closes the newer app connection.
- Production database read confirmed the `id,revision` projection is available.
- Build and whitespace checks passed.

Browser tests use isolated data/mocks and do not execute live stock transactions.
These checks do not replace a multi-device sale/return/transfer test in staging.

## Tradeoff and follow-up

The correctness repair deliberately reads the small revision manifest each refresh.
It avoids full product downloads for unchanged rows, but is not an O(changes-only)
metadata feed. A future optimization should introduce a commit-safe feed/snapshot
protocol and verify late commits, retained-log gaps, restores and pagination before
removing manifest reconciliation. Merely switching to timestamps is insufficient.

Next priorities: staging tests with multiple devices and delayed networks; then
reduce full-catalog processing/cache writes, split JavaScript by page, and improve
inventory loading. Database-size monitoring and external audit archival can follow;
no audit or idempotency history should be deleted as part of these bug fixes.

# Master sync recovery — 2026-09-14

## Evidence and cause

- Two open contacts `delete_rows` events referenced records already absent from the server; the audit trail confirmed earlier deletion. `deleteRevisionedRows` treated an empty DELETE result as an edit conflict without checking existence.
- Legacy workspace recovery could retain all supplier rows because old clients synthesized customer loyalty dates for suppliers. Unknown legacy payloads could also remain in the panel even when the normal changed-row snapshot considered them clean.
- Immediate contact saves and background master sync used independent writers and acknowledgement maps. A rejected editor save restored the entire contacts array.
- Contacts failures aborted the rest of core sync. Old events from other devices were presented together with current-device work.

## Changes and safety boundaries

- Serialize contact/master sends within a tab; retain revision predicates for concurrency between devices. Use the current array/baseline on acknowledgement.
- A zero-row DELETE is acknowledged only after a successful independent missing-row read for contacts/representatives, whose authenticated SELECT policies expose the full table. Changed revisions, failed reads, and scoped-table absence remain conflicts.
- Recognize an already committed insert by both creation token and matching payload, including a retry rejected by the phone index. Preserve real duplicate-phone errors. Recognize already committed updates by exact content without forcing a revision overwrite.
- Process master records independently in bounded groups; continue other tables after failures. Pause unchanged terminal conflicts until the draft changes or the user explicitly retries.
- Reconcile equivalent legacy supplier metadata by read only. Preserve unknown legacy edits without sending them blindly. Do not display synced while recovery work remains.
- Retain failed network drafts. Roll back only an unchanged, definitively rejected customer-phone draft, preserving unrelated/newer edits and prior recovery metadata.
- Provide read-only local/server comparison; separate current-device events, other-device events, and resolved history. Do not resolve other-device events merely because they are old.

No database migration, stock/LOT mutation, bulk cache deletion, or forced server-wins reset is included.

## Verification

- `node --test tests/master-sync-recovery.test.js`: missing/already-deleted rows, read failures, genuine conflicts across batches, paused retries, duplicate ID/phone retries, legacy metadata, simultaneous saves, rollback and queue isolation.
- `node tests/master-sync-browser.test.js --built`: synthetic 89 supplier rows plus two already-deleted contacts (91 pending) reconcile to zero without modifying any existing server record; comparison, history separation and mobile width verified. External requests are blocked.
- Run all static tests and the existing browser suite before release. This fixture is not a claim that the user's live pending queue has been cleared; confirm it separately after the deployed app loads.

## Operations

Use the pending-work export before manual conflict resolution. Reload the updated app, allow sync, and inspect remaining differences. Do not press server-wins for genuine unsent edits without reviewing them. Other devices must load the updated app and finish their own recovery before their old events can safely be considered resolved.

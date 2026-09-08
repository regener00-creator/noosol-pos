# Product revision conflict repair — 2026-09-08

## Changes

- Mobile saves call `owner_update_mobile_product_details_revisioned` with the version displayed on the device. The owner-only RPC locks and checks the product before mutation and returns its canonical row and committed revision in the same transaction. It retains existing stock/LOT rules and maintenance gate.
- Desktop product-list refresh compares compact ID/revision pairs, downloading full metadata only for changed, clean products. Same-color price/unit changes now refresh as well. Dirty edits and active editors remain protected.
- An update conflict is acknowledged without writing if the server already contains the exact intended metadata. A revision-only difference can be rebased only when all server metadata still equals the known local baseline, and the retry is revision-guarded again.
- Genuine conflicts keep their durable local edits. Identical automatic retries are paused for the session, without repeated requests, error events, or increasing the failure count. Explicit “ลองซิงก์ใหม่” permits another guarded attempt.
- Successful products clear their own dirty flags even when another product conflicts. Other master/document/inspection sync stages continue; the overall status remains unsuccessful while a product conflict remains.

## Database verification

Migration `20260908084206_mobile_product_revision_sync.sql` applied to the linked project before frontend release. Transactional checks on the database passed, with **all test data writes rolled back**:

- Stale expected revision raises `40001 / REVISION_CONFLICT` and leaves the row unchanged.
- Returned product matches the canonical database row and contains the incremented revision.
- A second save using the returned revision succeeds.
- Anonymous and non-owner callers are rejected; the anonymous role has no EXECUTE grant.

The Supabase skill guided retaining version checks and least-privilege access. The PostgreSQL guidance informed the short transaction and existing LOT-before-product lock order. Vercel deployment guidance requires the backend change to be ready before releasing the new client.

Security advisors also flag authenticated SECURITY DEFINER functions, including this intentional owner-only endpoint. The checks above verify its runtime ownership boundary. Existing findings include the public owner-bootstrap probe, two private RLS tables with no policies, and disabled leaked-password protection; these were not changed in this scoped repair. See [Supabase's function privilege guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Client verification and operational notes

- Dependency-free regression suite: 127 tests passed, including seven new conflict/queue cases.
- All 16 browser suites passed (the isolated product-search fixture was corrected and rerun after the combined suite).
- Mobile/desktop browser regression checks cover consecutive mobile saves, returned revision, green/yellow/normal states, same-color price changes, dirty-edit preservation, unchanged-row fetch suppression, and the actual refresh timer.
- Built page-chunk verification passes all 24 routes. Fixed the test's external-URL interception pattern and supplied an isolated user-list fixture; it now asserts the mock database client exists before rendering routes. No production user-list behavior was changed.
- Legacy mobile RPC is retained for already-open clients. Both mobile and desktop must reload to use the new guarded endpoint.
- No pending user edits or sync-event history are cleared by this release. Existing genuine conflicts still require review. “โหลดข้อมูลล่าสุด” explicitly replaces that product's pending local edits with the server version; do not use it blindly or clear browser storage.
- Mocked browser tests and rolled-back database checks verify the boundaries separately; they do not claim an observed successful save from the user's physical phone.

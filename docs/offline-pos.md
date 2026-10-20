# Offline POS

Sign in online once on the same browser after installing this version. A complete
catalog, permissions, warehouse balances, settings and cash-shift snapshot must
finish loading. The production service worker precaches the app and the pinned
Supabase SDK from the same origin. Clearing browser/site data removes these local
copies; private browsing is unsuitable for keeping unsent receipts.

The last signed-in account can reopen the app offline. Offline password entry
uses a per-account salted PBKDF2-SHA256 verifier (600,000 iterations); the password
is never persisted. Local access uses the last downloaded permissions. Server
access always requires a valid Supabase session and current server permissions.
A revoked/expired session may require signing in again before upload.

Checkout commits a full immutable request to IndexedDB before clearing the cart.
Each receipt has an OFF-UUID reference, the original seller, warehouse, shift,
prices, quantities, payment and sale timestamp. The stock shown locally subtracts
pending sales. It cannot include sales from other offline devices.

The online event, app startup/focus and a retry timeout while work is pending send
receipts using the original `complete_sale` UUID and exact payload. The server's
existing idempotency and stock transaction remain authoritative. A lost response
retries the same request. A completion is retained locally until authoritative
inventory is refreshed. Automatic sync runs while the app is open.

Offline opening of a cash shift is saved locally; reconnect reuses the seller's
open warehouse shift or opens one with the saved opening cash. Closing a shift,
logging out and resetting this device are blocked while receipts are unsent.
For a shift opened online, the server rejects a new offline receipt if that
original shift has since closed, rather than assigning it to a later shift.

Receipt printing works offline and identifies pending receipts. A full tax invoice,
loyalty redemption and checkout from quotations require online confirmation.
The server still checks current product prices, promotions, units, taxes and
permissions. Rejected receipts remain in the queue with an error and a downloadable
recovery copy; they are never silently discarded or repriced.

Offline timestamps allow up to 30 days of delay and five minutes of positive
clock skew. The server records receipt time separately. OFF references remain
available after sync alongside the assigned server reference.

Verification:

- `node tests/offline-sales-browser.test.js`: real IndexedDB, offline login and
  reload, several receipts, storage failure, account mismatch, automatic reconnect,
  lost response and idempotent retry.
- `node scripts/build-static.mjs` then `node tests/offline-shell-browser.test.js`:
  production bundles, real SDK/service worker, actual disconnected browser,
  navigation, sale and reload.
- `node scripts/run-database-tests.mjs --offline-only`: real PostgreSQL RPC,
  timestamp/shift guards, duplicate stock prevention and existing price validation.

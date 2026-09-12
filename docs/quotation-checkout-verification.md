# Quotation checkout verification — 2026-09-12

## Behavior

- Creating a quotation or opening it in POS does not reserve/deduct inventory.
- On successful payment, `complete_sale` validates the saved quotation, customer,
  product, unit and source line, uses its quoted unit price, and commits the sale
  and stock deduction atomically. Catalog price validation remains unchanged for
  ordinary sales; customer-price and loyalty checks are preserved.
- A changed/missing quote or tampered price is rejected with a Thai recovery
  message. The cart remains available. No bill or inventory mutation is committed.
- Retrying an already-completed request returns the original sale before reading
  mutable quotation data; it does not deduct stock twice.
- Old held carts without a source line index work only with an unambiguous price.
  Legacy name-only document rows are supported, but cannot override an explicit
  product ID that no longer exists. Duplicate product rows use their own index.
- Existing behavior allowing confirmation to sell the same quote again is not
  changed. A new intentional checkout is different from retrying one request.
- Quantities and header discounts remain editable under the existing POS rules;
  this change authorizes quoted unit prices, not a new partial-fulfillment system.

## Verification

- `pnpm run build`: 136 tests passed and static assets built.
- `node tests/quotation-checkout-browser.test.js`: isolated browser checks cover
  the quotation-to-POS button, distinct line indices including zero, payment
  payload, rejected-price message, retained cart, and successful completion.
  All external requests are blocked/stubbed; it cannot create a real sale.
- `node tests/document-party-picker-browser.test.js`: existing document and
  quotation form regressions passed.
- `tests/quotation-checkout.sql`: live checkout integration inside one explicit
  rollback transaction. Covers catalog-vs-quote pricing, customer/product/unit
  validation, old carts, duplicate lines, zero quotes, unit conversion, rejected
  mutations, and idempotency. Synthetic fixtures only; no test bills/products/
  quotes remain after rollback. Never run this script without its ROLLBACK.
- Applied migration: `20260912073536_allow_verified_quotation_prices`.
- No production user/payment interaction was automated.

## Advisor baseline

Before and after the migration, the advisor findings were unchanged. Performance
had no warnings/errors; 31 unused-index informational findings remain. Existing
security warnings were not modified as part of quotation pricing:

- One [anonymous security-definer endpoint](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
- 28 [authenticated security-definer endpoints](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), including the existing authenticated atomic checkout entrypoint.
- [Leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Two private RLS tables without policies remain informational findings.

The new helper is security-invoker, has an empty search path, and is not directly
executable by `anon` or `authenticated`; the existing checkout permission gates
and transaction structure are retained. These checks do not constitute a full
system security audit.

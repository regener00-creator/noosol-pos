# Quotation revision-loss incident

## Cause and fix

`saveQuotation()` rebuilt an edited quotation without `_revision` or
`createdByUserId`. The synchronizer consequently sent expected revision zero,
which correctly conflicted with the document already stored on the server.
Edits now retain the existing record's revision, provenance, links and snapshot,
while replacing the form-editable fields. Server conflict checks are unchanged;
the fix does not retry against a newer server revision or overwrite another edit.

The pending-work export also revealed unchanged sample invoices and a credit
note from the initial application arrays. All initial document arrays now start
empty. Existing local or server documents are not automatically deleted by this
code change; pending records still require an explicit recovery choice.

## Recovery decision

The user selected the server quotation (120 THB), not the local edit (3,720 THB),
and approved removing the three unchanged sample records from the local outbox.
The user supplied a JSON export containing all four pending entries before any
recovery action. Recovery must use the application's durable recovery controls;
no sale, stock posting, or server quotation overwrite is needed.

## Regression coverage

`tests/quotation-sync-regression.test.js` executes the actual form-save and
revisioned-save functions, covering original revision transmission, retained
provenance/document links, new-document revision zero and empty initial arrays.

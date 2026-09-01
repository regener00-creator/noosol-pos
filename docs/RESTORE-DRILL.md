# Restore drill

The `Restore drill (test database only)` workflow restores a real PEPOS backup into a separate Supabase test project and compares product and LOT counts after the transaction.

Configure the protected GitHub environment `restore-test` with these secrets:

- `RESTORE_TEST_SUPABASE_URL`
- `RESTORE_TEST_SUPABASE_KEY`
- `RESTORE_TEST_OWNER_EMAIL`
- `RESTORE_TEST_OWNER_PASSWORD`
- `RESTORE_DRILL_BACKUP_BASE64` (a PEPOS backup JSON encoded as Base64)

The script refuses to run against the Production project id. Run the workflow manually after schema changes and at least quarterly. Review the result before restoring any backup into Production.

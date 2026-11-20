# Restore drill

The `Restore drill (test database only)` workflow restores a shop backup into a separate Supabase test project. The test project must already contain the destination warehouse. Version 4 uses the warehouse ID in the file. Version 3 restores the original warehouse (ID 1). The server verifies all restored tables and checks that other shops remained intact. The drill then re-exports the destination shop and checks product, balance, LOT and sale counts. For current version 4 backups it also compares the checksums of those four tables.

Configure the protected GitHub environment `restore-test` with these secrets:

- `RESTORE_TEST_SUPABASE_URL`
- `RESTORE_TEST_SUPABASE_KEY`
- `RESTORE_TEST_OWNER_EMAIL`
- `RESTORE_TEST_OWNER_PASSWORD`
- `RESTORE_DRILL_BACKUP_BASE64` (a PEPOS backup JSON encoded as Base64)

The script refuses to run against the Production project id. Run the workflow manually after schema changes and at least quarterly. Review the result before restoring any backup into Production.

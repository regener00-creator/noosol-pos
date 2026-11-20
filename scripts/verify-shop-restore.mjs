export async function verifyShopRestore(client, payload) {
  const version = Number(payload?.version);
  const warehouseId = version === 3 ? 1 : Number(payload?.warehouseId);
  if (payload?.format !== 'pepos-pharmacy-store-backup' || ![3, 4].includes(version)
      || !Number.isSafeInteger(warehouseId) || warehouseId < 1) {
    throw new Error('A complete version 3 or shop-specific version 4 backup is required');
  }

  const { data: result, error } = await client.rpc('restore_store_backup_atomic', {
    p_warehouse_id: warehouseId, p_backup: payload
  });
  if (error) throw error;
  if (!result?.ok || !result.verified || Number(result.warehouseId) !== warehouseId) {
    throw new Error('The server did not verify the restore for the requested shop');
  }
  const { data: restored, error: exportError } = await client.rpc('export_store_backup', { p_warehouse_id: warehouseId });
  if (exportError) throw exportError;
  if (Number(restored?.warehouseId) !== warehouseId || Number(restored.version) !== 4) {
    throw new Error('The verification export did not return the restored shop');
  }

  // The restore transaction verifies every table. Independently re-export core business data.
  // Older files are normalized for shop ownership and per-shop barcode numbering on restore.
  const tables = ['public.products', 'public.inventory_balances', 'public.inventory_lots', 'public.sales'];
  for (const table of tables) {
    const actual = restored.manifest?.[table];
    if (!actual || actual.rows !== result.counts?.[table]) throw new Error('Restored row count differs for ' + table);
    if (version === 4 && payload.shopLabelBarcodes && payload.shopLetterNumbering
        && actual.md5 !== payload.manifest?.[table]?.md5) throw new Error('Restored contents differ for ' + table);
  }
  return { ok: true, warehouseId, epoch: result.epoch, verifiedTables: tables.length };
}

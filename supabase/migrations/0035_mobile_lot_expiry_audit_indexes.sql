-- Keep Lot expiry audit lookups and foreign-key maintenance fast as history grows.

create index if not exists idx_inventory_lot_detail_audit_product_warehouse
on private.inventory_lot_detail_audit(product_id,warehouse_id,created_at desc);

create index if not exists idx_inventory_lot_detail_audit_warehouse
on private.inventory_lot_detail_audit(warehouse_id,created_at desc);

-- Direct API access is intentionally denied. SECURITY DEFINER owner RPCs are
-- the only writers, while service_role retains operational access.
drop policy if exists inventory_lot_detail_audit_no_direct_access
on private.inventory_lot_detail_audit;

create policy inventory_lot_detail_audit_no_direct_access
on private.inventory_lot_detail_audit
for all
to public
using (false)
with check (false);

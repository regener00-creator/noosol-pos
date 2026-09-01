-- The current central Audit Log loads the newest page and filters it in the
-- browser. Keep only the chronological index that query can use; the three
-- unused filter indexes would add storage and write work without benefit.

drop index if exists public.idx_audit_logs_entity_occurred;
drop index if exists public.idx_audit_logs_actor_occurred;
drop index if exists public.idx_audit_logs_warehouse_occurred;

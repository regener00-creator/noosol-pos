-- Compact confirmed oversized indexes while retaining every index and row.
-- Bounded locks: if the shop is busy this migration aborts instead of waiting
-- indefinitely behind checkout. Retry later; never drop transaction history.
set local lock_timeout='2s';
set local statement_timeout='30s';
reindex index public.idx_products_name;
reindex index public.products_representative_search_trgm_idx;
reindex index private.operation_ledger_actor_created_idx;
-- These small, frequently updated tables should not wait for 20% churn before
-- reclaiming dead tuples and refreshing planner statistics.
alter table public.products set (autovacuum_vacuum_scale_factor=0.05,autovacuum_analyze_scale_factor=0.05);
alter table private.operation_ledger set (autovacuum_vacuum_scale_factor=0.05,autovacuum_analyze_scale_factor=0.05);
alter table public.sync_events set (autovacuum_vacuum_scale_factor=0.05,autovacuum_analyze_scale_factor=0.05);
analyze public.products;
analyze private.operation_ledger;
analyze public.sync_events;

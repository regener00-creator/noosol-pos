-- Cover the audit-table foreign key used when reviewing changes by owner.

create index if not exists idx_product_unit_changes_changed_by
on public.product_unit_changes(changed_by);

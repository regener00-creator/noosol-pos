-- Link structured representative/product activity to the existing shared NOTE
-- system. Generic notes keep every new column NULL, while activity notes can be
-- queried as a timeline without duplicating note content in a second table.

alter table public.notes
  add column if not exists representative_id bigint
    references public.sales_representatives(id) on delete set null,
  add column if not exists product_id bigint
    references public.products(id) on delete set null,
  add column if not exists activity_type text,
  add column if not exists event_date date,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists quoted_price numeric,
  add column if not exists minimum_quantity numeric,
  add column if not exists unit text,
  add column if not exists reminder_date date;

alter table public.notes
  drop constraint if exists notes_activity_type_check,
  add constraint notes_activity_type_check check (
    activity_type is null or activity_type in (
      'promotion','price_quote','contact','purchase_order',
      'goods_receipt','product_return','general'
    )
  ),
  drop constraint if exists notes_activity_event_date_check,
  add constraint notes_activity_event_date_check check (
    activity_type is null or event_date is not null
  ),
  drop constraint if exists notes_activity_valid_range_check,
  add constraint notes_activity_valid_range_check check (
    valid_from is null or valid_to is null or valid_to >= valid_from
  ),
  drop constraint if exists notes_activity_quoted_price_check,
  add constraint notes_activity_quoted_price_check check (
    quoted_price is null or quoted_price >= 0
  ),
  drop constraint if exists notes_activity_minimum_quantity_check,
  add constraint notes_activity_minimum_quantity_check check (
    minimum_quantity is null or minimum_quantity > 0
  );

create index if not exists notes_representative_activity_idx
  on public.notes(representative_id,event_date desc,updated_at desc)
  where activity_type is not null;

create index if not exists notes_product_activity_idx
  on public.notes(product_id,event_date desc,updated_at desc)
  where activity_type is not null;

create index if not exists notes_activity_reminder_idx
  on public.notes(reminder_date)
  where activity_type is not null and reminder_date is not null;

revoke insert (representative_id,product_id,activity_type,event_date,valid_from,valid_to,quoted_price,minimum_quantity,unit,reminder_date)
  on table public.notes from anon;
revoke update (representative_id,product_id,activity_type,event_date,valid_from,valid_to,quoted_price,minimum_quantity,unit,reminder_date)
  on table public.notes from anon;
grant insert (representative_id,product_id,activity_type,event_date,valid_from,valid_to,quoted_price,minimum_quantity,unit,reminder_date)
  on table public.notes to authenticated;
grant update (representative_id,product_id,activity_type,event_date,valid_from,valid_to,quoted_price,minimum_quantity,unit,reminder_date)
  on table public.notes to authenticated;

-- NOTE changes, including representative activity notes, belong in the central
-- audit history just like representative and product master-data changes.
drop trigger if exists audit_notes_changes on public.notes;
create trigger audit_notes_changes
after insert or update or delete on public.notes
for each row execute function private.capture_audit_log('notes');


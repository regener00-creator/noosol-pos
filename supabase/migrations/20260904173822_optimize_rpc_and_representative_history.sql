-- Bound NOTE and representative-history reads with keyset pagination, retire
-- compatibility RPCs after their rollout window, and make the browser RPC
-- surface an explicit least-privilege allow-list.

create extension if not exists pg_trgm with schema extensions;

drop index if exists public.notes_updated_at_idx;
create index notes_updated_at_idx
  on public.notes(updated_at desc,id desc)
  where activity_type is null and representative_id is null;

drop index if exists public.notes_representative_activity_idx;
create index notes_representative_activity_idx
  on public.notes(representative_id,event_date desc,updated_at desc,id desc)
  where activity_type is not null;

create index if not exists notes_search_trgm_idx
  on public.notes using gin (
    (lower(coalesce(title,'') || ' ' || coalesce(content_html,'')))
    extensions.gin_trgm_ops
  );

create index if not exists sales_representatives_search_trgm_idx
  on public.sales_representatives using gin (
    (lower(coalesce(name,'') || ' ' || coalesce(data->>'company','')))
    extensions.gin_trgm_ops
  );

create index if not exists products_representative_search_trgm_idx
  on public.products using gin (
    (lower(
      coalesce(name,'') || ' ' || coalesce(sku,'') || ' '
      || coalesce(data->>'barcode','')
    )) extensions.gin_trgm_ops
  );

create or replace function public.get_notes_page(
  p_search text default null,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 100
) returns setof public.notes
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_search text := lower(nullif(btrim(coalesce(p_search,'')),''));
  v_limit integer := least(greatest(coalesce(p_limit,100),1),100);
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  return query
  select note.*
  from public.notes note
  where note.activity_type is null
    and note.representative_id is null
    and (
      v_search is null
      or lower(coalesce(note.title,'') || ' ' || coalesce(note.content_html,''))
         like '%' || v_search || '%'
    )
    and (
      p_cursor_updated_at is null
      or (note.updated_at,note.id) < (p_cursor_updated_at,p_cursor_id)
    )
  order by note.updated_at desc,note.id desc
  limit v_limit + 1;
end;
$$;

create or replace function public.get_representative_page(
  p_representative_id bigint default null,
  p_product_id bigint default null,
  p_representative_search text default null,
  p_product_search text default null,
  p_note_search text default null,
  p_cursor_name text default null,
  p_cursor_id bigint default null,
  p_limit integer default 24
) returns table(
  representative_id bigint,
  representative_name text,
  sort_name text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_representative_search text := lower(nullif(btrim(coalesce(p_representative_search,'')),''));
  v_product_search text := lower(nullif(btrim(coalesce(p_product_search,'')),''));
  v_note_search text := lower(nullif(btrim(coalesce(p_note_search,'')),''));
  v_limit integer := least(greatest(coalesce(p_limit,24),1),50);
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  return query
  select representative.id,representative.name,
         lower(coalesce(representative.name,'')) as sort_name
  from public.sales_representatives representative
  where (p_representative_id is null or representative.id=p_representative_id)
    and (
      p_product_id is null
      or exists (
        select 1
        from public.sales_representative_products assignment
        where assignment.representative_id=representative.id
          and assignment.product_id=p_product_id
      )
    )
    and (
      v_representative_search is null
      or lower(
        coalesce(representative.name,'') || ' '
        || coalesce(representative.data->>'company','') || ' '
        || coalesce(representative.data->>'phone','') || ' '
        || coalesce(representative.data->>'line','')
      ) like '%' || v_representative_search || '%'
    )
    and (
      v_product_search is null
      or exists (
        select 1
        from public.sales_representative_products assignment
        join public.products product on product.id=assignment.product_id
        where assignment.representative_id=representative.id
          and lower(
            coalesce(product.name,'') || ' '
            || coalesce(product.sku,'') || ' '
            || coalesce(product.data->>'barcode','')
          ) like '%' || v_product_search || '%'
      )
    )
    and (
      v_note_search is null
      or exists (
        select 1
        from public.notes note
        where note.representative_id=representative.id
          and note.activity_type is not null
          and lower(coalesce(note.title,'') || ' ' || coalesce(note.content_html,''))
              like '%' || v_note_search || '%'
      )
    )
    and (
      p_cursor_name is null
      or (
        lower(coalesce(representative.name,'')),representative.id
      ) > (p_cursor_name,p_cursor_id)
    )
  order by lower(coalesce(representative.name,'')),representative.id
  limit v_limit + 1;
end;
$$;

create or replace function public.get_representative_note_cards(
  p_representative_ids bigint[],
  p_search text default null,
  p_limit_per_representative integer default 3
) returns setof public.notes
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_search text := lower(nullif(btrim(coalesce(p_search,'')),''));
  v_limit integer := least(greatest(coalesce(p_limit_per_representative,3),1),10);
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if coalesce(cardinality(p_representative_ids),0) > 50 then
    raise exception 'too many representatives requested';
  end if;

  return query
  select note.*
  from unnest(coalesce(p_representative_ids,array[]::bigint[])) requested(representative_id)
  cross join lateral (
    select candidate.*
    from public.notes candidate
    where candidate.representative_id=requested.representative_id
      and candidate.activity_type is not null
      and (
        v_search is null
        or lower(coalesce(candidate.title,'') || ' ' || coalesce(candidate.content_html,''))
           like '%' || v_search || '%'
      )
    order by candidate.event_date desc nulls last,candidate.updated_at desc,candidate.id desc
    limit v_limit
  ) note
  order by note.representative_id,note.event_date desc nulls last,note.updated_at desc,note.id desc;
end;
$$;

create or replace function public.get_representative_notes_page(
  p_representative_id bigint,
  p_search text default null,
  p_cursor_event_date date default null,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns setof public.notes
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_search text := lower(nullif(btrim(coalesce(p_search,'')),''));
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if p_representative_id is null then
    raise exception 'representative is required';
  end if;

  return query
  select note.*
  from public.notes note
  where note.representative_id=p_representative_id
    and note.activity_type is not null
    and (
      v_search is null
      or lower(coalesce(note.title,'') || ' ' || coalesce(note.content_html,''))
         like '%' || v_search || '%'
    )
    and (
      p_cursor_event_date is null
      or (
        coalesce(note.event_date,date '0001-01-01'),note.updated_at,note.id
      ) < (
        coalesce(p_cursor_event_date,date '0001-01-01'),p_cursor_updated_at,p_cursor_id
      )
    )
  order by note.event_date desc nulls last,note.updated_at desc,note.id desc
  limit v_limit + 1;
end;
$$;

-- The following compatibility endpoints are no longer referenced by the
-- current or previous service-worker cache version.
drop function if exists public.get_central_audit_logs(integer,integer);
drop function if exists public.resolve_sync_event(uuid);
drop function if exists public.save_representative_activity(
  uuid,timestamptz,text,text,bigint,text,date,date,date,date,jsonb
);
drop function if exists public.complete_sale(uuid,text,bigint,jsonb,jsonb);

-- New public-schema functions default to executable by PUBLIC in PostgreSQL.
-- Revoke that default and then grant only the browser RPCs listed below.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon,authenticated;

revoke execute on all functions in schema public from public,anon,authenticated;

grant execute on function public.has_any_owner()
  to anon,authenticated,service_role;

grant execute on function public.adjust_inventory_stock(bigint,bigint,numeric),
  public.apply_inventory_transfer(text),
  public.can_current_user_page(text,bigint,text),
  public.close_cash_shift(uuid,numeric,text),
  public.complete_sale(uuid,text,bigint,jsonb,jsonb,text),
  public.delete_held_sale(text),
  public.delete_unused_product(bigint),
  public.export_store_inventory_backup(),
  public.get_central_audit_log_page(integer,timestamptz,text,text,text,text,text,boolean),
  public.get_notes_page(text,timestamptz,uuid,integer),
  public.get_representative_page(bigint,bigint,text,text,text,text,bigint,integer),
  public.get_representative_note_cards(bigint[],text,integer),
  public.get_representative_notes_page(bigint,text,date,timestamptz,uuid,integer),
  public.open_cash_shift(bigint,numeric),
  public.owner_delete_warehouse(bigint),
  public.owner_set_setting(text,jsonb),
  public.owner_update_mobile_product_details(bigint,bigint,bigint,jsonb,numeric,numeric,date),
  public.owner_upsert_warehouse(bigint,text,jsonb),
  public.record_goods_receipt_payment(text,jsonb),
  public.record_print_event(text,text,text,integer,bigint,jsonb),
  public.report_client_event(text,text,text,text,text,text,text,text,jsonb),
  public.resolve_own_sync_events(text,timestamptz),
  public.restore_store_backup_atomic(jsonb),
  public.run_stock_operation(uuid,text,jsonb),
  public.save_held_sale(jsonb),
  public.save_representative_note(uuid,timestamptz,text,text,bigint,date,jsonb),
  public.save_representative_products(bigint,jsonb),
  public.save_revisioned_document(uuid,text,text,jsonb,bigint,boolean),
  public.set_inventory_expiry(bigint,bigint,date),
  public.set_inventory_stock(bigint,bigint,numeric),
  public.update_sale_document_metadata(text,jsonb)
  to authenticated,service_role;

comment on function public.get_notes_page(text,timestamptz,uuid,integer)
  is 'Returns one RLS-filtered standalone NOTE keyset page plus one look-ahead row.';
comment on function public.get_representative_page(bigint,bigint,text,text,text,text,bigint,integer)
  is 'Searches and keyset-pages representatives on the server.';
comment on function public.get_representative_note_cards(bigint[],text,integer)
  is 'Returns a bounded number of representative NOTE cards per representative.';
comment on function public.get_representative_notes_page(bigint,text,date,timestamptz,uuid,integer)
  is 'Returns one RLS-filtered representative NOTE keyset page plus one look-ahead row.';

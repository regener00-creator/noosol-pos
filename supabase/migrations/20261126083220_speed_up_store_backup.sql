-- Keep the same ordered, canonical table payloads for export and restore.
create or replace function private.shop_backup_rows(t text,w bigint,staged boolean default false)
returns jsonb
language plpgsql stable
set search_path=''
as $$
declare rows jsonb;
begin
  execute format(
    'with canonical_rows as materialized (
       select private.backup_canonical_json(to_jsonb(r)) as row_data
       from %s r where %s
     )
     select coalesce(jsonb_agg(row_data order by row_data::text),''[]''::jsonb)
     from canonical_rows',
    private.shop_backup_relation(t,staged),private.shop_backup_where(t,w,staged)
  ) into rows;
  return rows;
end;
$$;

-- Build both objects once instead of appending to a growing JSON document.
create or replace function public.export_store_backup(p_warehouse_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path=''
set statement_timeout='30s'
as $$
declare
  tables jsonb;
  manifest jsonb;
  shop text;
  number_state jsonb;
begin
  if auth.uid() is null or not private.is_current_owner() then
    raise exception 'owner access required';
  end if;
  select name into strict shop from public.warehouses where id=p_warehouse_id;

  with snapshots as materialized (
    select table_name,private.shop_backup_rows(table_name,p_warehouse_id) as rows
    from unnest(private.shop_backup_tables()||private.shop_backup_history()) as t(table_name)
  )
  select jsonb_object_agg(table_name,rows),
         jsonb_object_agg(table_name,jsonb_build_object('rows',jsonb_array_length(rows),'md5',md5(rows::text)))
    into tables,manifest
    from snapshots;

  number_state:=private.shop_number_backup(p_warehouse_id);
  return jsonb_build_object(
    'format','pepos-pharmacy-store-backup','version',4,
    'shopLetterNumbering',true,'shopLabelBarcodes',true,
    'numberState',number_state,'numberStateHash',md5(number_state::text),
    'warehouseId',p_warehouse_id,'warehouseName',shop,
    'createdAt',statement_timestamp(),'data',jsonb_build_object('tables',tables),'manifest',manifest
  );
end;
$$;

notify pgrst,'reload schema';

create table public.standalone_cash_bills (
  id uuid primary key,
  warehouse_id bigint not null references public.warehouses(id),
  number text not null unique,
  issued_at timestamptz not null default now(),
  printed boolean not null default false,
  data jsonb not null check (jsonb_typeof(data)='object' and
    jsonb_typeof(data->'items')='array' and jsonb_array_length(data->'items')>0
    and data ?& array['items','customer','date','total'])
);
create index standalone_cash_bills_store_date on public.standalone_cash_bills(warehouse_id,issued_at desc,id);
alter table public.standalone_cash_bills enable row level security;
revoke all on public.standalone_cash_bills from public, anon, authenticated;
grant select, delete on public.standalone_cash_bills to authenticated;
grant insert(id,warehouse_id,data), update(printed) on public.standalone_cash_bills to authenticated;
create policy cash_bills_assigned_store on public.standalone_cash_bills for all to authenticated
  using ((select private.is_current_owner()) or exists(select 1 from public.profile_warehouse_access a
    where a.user_id=(select auth.uid()) and a.warehouse_id=standalone_cash_bills.warehouse_id and a.can_sell));

create function private.number_standalone_cash_bill() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.acquire_store_mutation_gate();
  if new.number is null then
    new.number:=private.next_shop_number(new.warehouse_id,'cashBill',(now() at time zone 'Asia/Bangkok')::date,new.id);
  end if;
  return new;
end $$;
revoke all on function private.number_standalone_cash_bill() from public,anon,authenticated;
create trigger number_standalone_cash_bill before insert on public.standalone_cash_bills
  for each row execute function private.number_standalone_cash_bill();

-- Include independently issued receipts in shop exports, resets and restores.
do $$
declare body text;
begin
  body:=pg_get_functiondef('private.shop_backup_tables()'::regprocedure);
  if strpos(body,'''public.combined_catalog_unit_preferences'']')=0 then raise exception 'unexpected shop backup list'; end if;
  execute replace(body,'''public.combined_catalog_unit_preferences'']','''public.combined_catalog_unit_preferences'',''public.standalone_cash_bills'']');
  body:=pg_get_functiondef('private.shop_backup_where(text,bigint,boolean)'::regprocedure);
  if strpos(body,'''public.cash_shifts''')=0 then raise exception 'unexpected shop filter'; end if;
  execute replace(body,'''public.cash_shifts''','''public.cash_shifts'',''public.standalone_cash_bills''');
  body:=pg_get_functiondef('public.restore_store_backup_atomic(bigint,jsonb)'::regprocedure);
  if strpos(body,'r:=raw->t;')=0 then raise exception 'unexpected shop restore'; end if;
  execute replace(body,'r:=raw->t;', $compat$r:=raw->t;
   if t='public.standalone_cash_bills' and r is null and not (p_backup->'manifest' ? t) then
     r:='[]'::jsonb;
     p_backup:=jsonb_set(p_backup,array['manifest',t],jsonb_build_object('rows',0,'md5',md5(r::text)));
   end if;$compat$);
end $$;

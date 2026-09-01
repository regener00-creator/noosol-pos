-- Warehouse-aware document posting and expiry updates.

create or replace function public.set_inventory_expiry(
  p_product_id bigint, p_warehouse_id bigint, p_expiry date
) returns date
language plpgsql security definer set search_path=''
as $$
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access a
    where a.user_id=(select auth.uid()) and a.warehouse_id=p_warehouse_id and a.can_manage_stock
  ) then raise exception 'stock management access denied'; end if;
  insert into public.inventory_balances(warehouse_id,product_id,stock,expiry,updated_at)
  values(p_warehouse_id,p_product_id,0,p_expiry,now())
  on conflict (warehouse_id,product_id) do update set expiry=excluded.expiry,updated_at=now();
  return p_expiry;
end;
$$;

create or replace function public.seed_product_inventory_balance()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.warehouse_id is not null then
    insert into public.inventory_balances(warehouse_id,product_id,stock,expiry)
    values(new.warehouse_id,new.id,coalesce(new.stock,0),
      case when coalesce(new.data->>'expiry','') ~ '^\d{4}-\d{2}-\d{2}$' then (new.data->>'expiry')::date else null end)
    on conflict (warehouse_id,product_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_seed_product_inventory_balance on public.products;
create trigger trg_seed_product_inventory_balance
after insert on public.products
for each row execute function public.seed_product_inventory_balance();

create or replace function public.apply_inventory_transfer(p_transfer_id text)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_row public.transfers%rowtype; v_data jsonb; v_item jsonb; v_product_id bigint; v_qty numeric; v_factor numeric; v_unit jsonb; v_from bigint; v_to bigint;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner permission required'; end if;
  select * into v_row from public.transfers where id=p_transfer_id for update;
  if not found then raise exception 'transfer not found'; end if;
  v_data:=coalesce(v_row.data,'{}'::jsonb);
  if coalesce((v_data->>'stockApplied')::boolean,false) then return v_data; end if;
  v_from:=nullif(v_data->>'fromId','')::bigint; v_to:=nullif(v_data->>'toId','')::bigint;
  if v_from is null or v_to is null or v_from=v_to then raise exception 'invalid transfer warehouse'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(v_data->'items','[]'::jsonb)) loop
    v_product_id:=nullif(v_item->>'productId','')::bigint; v_factor:=1; v_unit:=null;
    select u.value into v_unit from public.products p, lateral jsonb_array_elements(coalesce(p.data->'units','[]'::jsonb)) u(value)
    where p.id=v_product_id and u.value->>'sub'=v_item->>'unit' limit 1;
    if v_unit is not null then v_factor:=coalesce(nullif(v_unit->>'factor','')::numeric,1); end if;
    v_qty:=coalesce(nullif(v_item->>'qty','')::numeric,0)*v_factor;
    if v_product_id is null or v_qty<=0 then raise exception 'invalid transfer item'; end if;
    perform public.transfer_inventory_stock(v_product_id,v_from,v_to,v_qty);
  end loop;
  v_data:=jsonb_set(jsonb_set(v_data,'{stockApplied}','true'::jsonb,true),'{stockAppliedAt}',to_jsonb(now()::text),true);
  update public.transfers set data=v_data,updated_at=now() where id=p_transfer_id;
  return v_data;
end;
$$;

create or replace function public.apply_product_exchange_status(p_exchange_id text, p_next_status text)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_row public.product_exchanges%rowtype; v_data jsonb; v_item jsonb; v_pid bigint; v_qty numeric; v_expiry date; v_warehouse bigint; v_outgoing boolean; v_incoming boolean;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner permission required'; end if;
  if p_next_status not in ('ส่งไปเปลี่ยนแล้ว','รับสินค้ากลับแล้ว') then raise exception 'invalid product exchange status'; end if;
  select * into v_row from public.product_exchanges where id=p_exchange_id for update;
  if not found then raise exception 'product exchange document not found'; end if;
  v_data:=coalesce(v_row.data,'{}'::jsonb); v_warehouse:=nullif(v_data->>'warehouseId','')::bigint;
  if v_warehouse is null then raise exception 'warehouse is required'; end if;
  v_outgoing:=coalesce((v_data->>'outgoingApplied')::boolean,false); v_incoming:=coalesce((v_data->>'incomingApplied')::boolean,false);
  if v_incoming then return jsonb_build_object('exchange',v_data); end if;
  if not v_outgoing then
    for v_item in select value from jsonb_array_elements(coalesce(v_data->'outgoingItems','[]'::jsonb)) loop
      v_pid:=nullif(v_item->>'pid','')::bigint;
      v_qty:=coalesce(nullif(v_item->>'baseQty','')::numeric,coalesce(nullif(v_item->>'qty','')::numeric,0)*coalesce(nullif(v_item->>'factor','')::numeric,1));
      if v_pid is null or v_qty<=0 or (select coalesce(stock,0) from public.inventory_balances where product_id=v_pid and warehouse_id=v_warehouse)<v_qty then raise exception 'insufficient stock for product %',v_pid; end if;
      perform public.adjust_inventory_stock(v_pid,v_warehouse,-v_qty);
    end loop;
    v_outgoing:=true; v_data:=jsonb_set(jsonb_set(v_data,'{outgoingApplied}','true'::jsonb,true),'{outgoingAppliedAt}',to_jsonb(now()::text),true);
  end if;
  if p_next_status='รับสินค้ากลับแล้ว' and not v_incoming then
    if jsonb_array_length(coalesce(v_data->'incomingItems','[]'::jsonb))=0 then raise exception 'incoming items are required'; end if;
    for v_item in select value from jsonb_array_elements(coalesce(v_data->'incomingItems','[]'::jsonb)) loop
      v_pid:=nullif(v_item->>'pid','')::bigint;
      v_qty:=coalesce(nullif(v_item->>'baseQty','')::numeric,coalesce(nullif(v_item->>'qty','')::numeric,0)*coalesce(nullif(v_item->>'factor','')::numeric,1));
      v_expiry:=nullif(v_item->>'expiry','')::date;
      if v_pid is null or v_qty<=0 or v_expiry is null then raise exception 'invalid incoming item'; end if;
      perform public.adjust_inventory_stock(v_pid,v_warehouse,v_qty);
      update public.inventory_balances set expiry=case when coalesce(stock,0)<=v_qty or expiry is null then v_expiry else least(expiry,v_expiry) end,updated_at=now()
      where product_id=v_pid and warehouse_id=v_warehouse;
    end loop;
    v_incoming:=true; v_data:=jsonb_set(jsonb_set(v_data,'{incomingApplied}','true'::jsonb,true),'{incomingAppliedAt}',to_jsonb(now()::text),true);
  end if;
  v_data:=jsonb_set(jsonb_set(v_data,'{status}',to_jsonb(p_next_status),true),'{updatedAt}',to_jsonb(now()::text),true);
  update public.product_exchanges set data=v_data,updated_at=now() where id=p_exchange_id;
  return jsonb_build_object('exchange',v_data);
end;
$$;

revoke execute on function public.set_inventory_expiry(bigint,bigint,date) from public,anon;
revoke execute on function public.apply_inventory_transfer(text) from public,anon;
revoke execute on function public.apply_product_exchange_status(text,text) from public,anon;
grant execute on function public.set_inventory_expiry(bigint,bigint,date) to authenticated;
grant execute on function public.apply_inventory_transfer(text) to authenticated;
grant execute on function public.apply_product_exchange_status(text,text) to authenticated;

-- Record a completed sale at the end of successful inventory posting, rather
-- than at the beginning of the checkout RPC. The same Bangkok timestamp is
-- stored in both the report columns and the JSON payload returned to the POS.

create or replace function public.complete_sale(
  p_request_id uuid,
  p_ref_prefix text,
  p_warehouse_id bigint,
  p_sale jsonb,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_existing public.sales%rowtype;
  v_request_id uuid:=p_request_id;
  v_now timestamptz;
  v_sale_date date;
  v_sale_id text;
  v_sale_ref text;
  v_posting jsonb;
  v_post_items jsonb;
  v_sale_data jsonb:=coalesce(p_sale,'{}'::jsonb);
  v_item jsonb;
  v_items jsonb:='[]'::jsonb;
  v_line_allocations jsonb;
  v_line_key text;
  v_ord bigint;
  v_member text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if v_request_id is null or p_warehouse_id is null then
    raise exception 'checkout request and warehouse are required';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then
    raise exception 'sale items are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text,0));
  select * into v_existing
  from public.sales
  where checkout_request_id=v_request_id;
  if found then
    return jsonb_build_object('sale',coalesce(v_existing.data,'{}'::jsonb),'alreadyCompleted',true);
  end if;

  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access access
    where access.user_id=(select auth.uid())
      and access.warehouse_id=p_warehouse_id
      and access.can_sell
  ) then raise exception 'warehouse sale access denied'; end if;

  v_sale_id:='INV-'||replace(v_request_id::text,'-','');
  select jsonb_agg(value order by
    coalesce(nullif(value->>'productId','')::bigint,9223372036854775807),
    coalesce(nullif(value->>'lineKey',''),ordinality::text),ordinality)
  into v_post_items
  from jsonb_array_elements(p_items) with ordinality;
  v_posting:=public.post_sale_inventory_lots(v_sale_id,p_warehouse_id,v_post_items);

  for v_item,v_ord in
    select value,ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_line_key:=coalesce(nullif(v_item->>'lineKey',''),v_ord::text);
    select coalesce(jsonb_agg(allocation order by allocation_order),'[]'::jsonb)
    into v_line_allocations
    from (
      select value as allocation,ordinality as allocation_order
      from jsonb_array_elements(coalesce(v_posting->'allocations','[]'::jsonb)) with ordinality
      where value->>'lineKey'=v_line_key
    ) matched;
    if not coalesce((v_item->>'custom')::boolean,false) then
      v_item:=jsonb_set(v_item,'{lotAllocations}',v_line_allocations,true);
    end if;
    v_items:=v_items||jsonb_build_array(v_item);
  end loop;

  -- Capture the business timestamp only after all stock work has succeeded.
  v_now:=clock_timestamp();
  v_sale_date:=(v_now at time zone 'Asia/Bangkok')::date;
  v_sale_ref:=private.next_sale_reference(v_sale_date,p_ref_prefix);

  v_sale_data:=jsonb_set(v_sale_data,'{id}',to_jsonb(v_sale_id),true);
  v_sale_data:=jsonb_set(v_sale_data,'{ref}',to_jsonb(v_sale_ref),true);
  v_sale_data:=jsonb_set(v_sale_data,'{date}',to_jsonb(v_sale_date::text),true);
  v_sale_data:=jsonb_set(v_sale_data,'{time}',to_jsonb(to_char(v_now at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI:SS')),true);
  v_sale_data:=jsonb_set(v_sale_data,'{warehouseId}',to_jsonb(p_warehouse_id),true);
  v_sale_data:=jsonb_set(v_sale_data,'{status}',to_jsonb('done'::text),true);
  v_sale_data:=jsonb_set(v_sale_data,'{items}',v_items,true);
  v_sale_data:=jsonb_set(v_sale_data,'{checkoutRequestId}',to_jsonb(v_request_id::text),true);

  v_member:=case
    when jsonb_typeof(v_sale_data->'member')='object' then nullif(v_sale_data->'member'->>'name','')
    else nullif(v_sale_data->>'member','')
  end;

  insert into public.sales(
    id,ref,sale_date,sale_time,cashier,member,status,pay_method,
    discount,vat,fee,cost_total,gross_profit,cash_received,cash_change,total,
    data,checkout_request_id
  ) values (
    v_sale_id,v_sale_ref,v_sale_date,v_now,nullif(v_sale_data->>'cashier',''),v_member,'done',nullif(v_sale_data->>'payMethod',''),
    coalesce(nullif(v_sale_data->>'discount','')::numeric,0),
    coalesce(nullif(v_sale_data->>'vat','')::numeric,0),
    coalesce(nullif(v_sale_data->>'fee','')::numeric,0),
    coalesce(nullif(v_sale_data->>'costTotal','')::numeric,0),
    coalesce(nullif(v_sale_data->>'grossProfit','')::numeric,0),
    coalesce(nullif(v_sale_data->>'cashReceived','')::numeric,0),
    coalesce(nullif(v_sale_data->>'cashChange','')::numeric,0),
    coalesce(nullif(v_sale_data->>'total','')::numeric,0),
    v_sale_data,v_request_id
  );

  return jsonb_build_object(
    'sale',v_sale_data,
    'allocations',coalesce(v_posting->'allocations','[]'::jsonb),
    'alreadyCompleted',false
  );
end;
$$;

revoke execute on function public.complete_sale(uuid,text,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.complete_sale(uuid,text,bigint,jsonb,jsonb) to authenticated;

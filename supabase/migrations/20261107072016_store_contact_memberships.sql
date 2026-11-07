-- All historical contacts and member bills at rollout belong to the original shop.
set local lock_timeout='5s';
alter table public.contacts add column warehouse_id bigint not null default 1 references public.warehouses(id);
create index contacts_warehouse_id_idx on public.contacts(warehouse_id,id);
create policy contacts_store_access on public.contacts as restrictive for all to authenticated
using (exists(select 1 from public.warehouses w where w.id=contacts.warehouse_id))
with check (exists(select 1 from public.warehouses w where w.id=contacts.warehouse_id));

-- Older backups can explicitly pass NULL for a column their format predates.
create function private.keep_contact_store() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and new.warehouse_id is distinct from old.warehouse_id then
    raise exception 'ไม่สามารถย้ายรายชื่อที่บันทึกแล้วไปอีกร้าน';
  end if;
  new.warehouse_id:=coalesce(new.warehouse_id,1);
  return new;
end $$;
revoke all on function private.keep_contact_store() from public,anon,authenticated;
create trigger contacts_keep_store before insert or update of warehouse_id on public.contacts
for each row execute function private.keep_contact_store();

drop index public.contacts_code_unique;
create unique index contacts_code_unique on public.contacts(warehouse_id,upper(btrim(data->>'code')))
where nullif(btrim(data->>'code'),'') is not null;
drop index public.contacts_customer_phone_unique;
create unique index contacts_customer_phone_unique on public.contacts
(warehouse_id,(regexp_replace(coalesce(phone,''),'[^0-9]','','g')))
where type in ('customer','both') and nullif(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'') is not null;

-- Reuse the earned/redeemed amounts saved on the original bills, including
-- their historical earn rates. A customer's immutable store defines its ledger.
create or replace function private.customer_loyalty_snapshot(p_customer_id bigint,p_at timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_joined timestamptz; v_store bigint; v_cycle jsonb; v_earned numeric; v_used numeric;
begin
  select coalesce((data->>'loyaltyJoinedAt')::timestamptz,created_at),warehouse_id into v_joined,v_store
  from public.contacts where id=p_customer_id and type in ('customer','both');
  if not found then raise exception 'LOYALTY_CUSTOMER_NOT_FOUND'; end if;
  v_cycle:=private.loyalty_cycle(v_joined,p_at);
  select coalesce(sum((data->'loyalty'->>'earned')::numeric),0),
         coalesce(sum((data->'loyalty'->>'redeemed')::numeric),0)
    into v_earned,v_used from public.sales
    where status='done' and data ? 'loyalty'
      and coalesce(data->>'warehouseId','1')=v_store::text
      and data->'loyalty'->>'customerId'=p_customer_id::text
      and data->'loyalty'->>'periodStart'=v_cycle->>'periodStart';
  return v_cycle||jsonb_build_object('customerId',p_customer_id::text,'earned',v_earned,'used',v_used,
    'balance',greatest(0,v_earned-v_used),'adjustmentDue',greatest(0,v_used-v_earned));
end $$;

-- Use the verified checkout warehouse for the customer lock and all reads.
-- Apply each change to the deployed function, preserving other checkout rules.
do $$
declare patch record; definition text;
begin
 for patch in select * from (values
   ('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)','private.finalize_sale_loyalty(v_sale_data)',
    'private.finalize_sale_loyalty(v_sale_data || jsonb_build_object(''warehouseId'',p_warehouse_id))'),
   ('private.finalize_sale_loyalty(jsonb)','where id=v_customer_id and type','where id=v_customer_id and warehouse_id=(p_sale->>''warehouseId'')::bigint and type'),
   ('private.read_customer_loyalty(text[],bigint)','where c.id::text=any(p_customer_ids)','where c.warehouse_id=p_warehouse_id and c.id::text=any(p_customer_ids)'),
   ('public.get_pos_customer_tier_progress(text,bigint)','where customer.id::text=p_customer_id','where customer.warehouse_id=p_warehouse_id and customer.id::text=p_customer_id'),
   ('public.get_pos_customer_tier_progress(text,bigint)','where sale.status=''done''','where coalesce(sale.data->>''warehouseId'',''1'')=p_warehouse_id::text and sale.status=''done'''),
   ('public.get_customer_purchase_history(text[],integer,integer,integer,boolean,bigint)','c.type in (''customer'',''both'')','c.warehouse_id=p_warehouse_id and c.type in (''customer'',''both'')'),
   ('public.get_customer_purchase_history(text[],integer,integer,integer,boolean,bigint)','and s.status in (''done'',''void'')','and coalesce(s.data->>''warehouseId'',''1'')=p_warehouse_id::text and s.status in (''done'',''void'')')
 ) edits(signature,original,replacement)
 loop
   definition:=pg_get_functiondef(patch.signature::regprocedure);
   if strpos(definition,patch.original)=0 then raise exception 'Missing store filter anchor on %',patch.signature; end if;
   execute replace(definition,patch.original,patch.replacement);
 end loop;
end $$;

-- Also protect held and directly synced bills, which do not finalize points.
create function private.check_sale_contact_store() returns trigger
language plpgsql security definer set search_path='' as $$
declare member_id text:=coalesce(nullif(new.data->>'customerId',''),new.data->'member'->>'id');
begin
  if member_id ~ '^[0-9]{1,18}$' then
    if exists(select 1 from public.contacts c where c.id=member_id::bigint
      and c.warehouse_id::text<>coalesce(new.data->>'warehouseId','1')) then
      raise exception 'ลูกค้าไม่ได้เป็นสมาชิกของร้านที่เลือก';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.check_sale_contact_store() from public,anon,authenticated;
create trigger sales_check_contact_store before insert or update of data on public.sales
for each row execute function private.check_sale_contact_store();

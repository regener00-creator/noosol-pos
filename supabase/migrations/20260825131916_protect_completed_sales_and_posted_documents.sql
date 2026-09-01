-- Immutable audit history: completed sales and inventory-posted documents may
-- be voided/corrected through dedicated workflows, but never deleted.

create or replace function private.protect_completed_sale_delete()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  if coalesce(old.status,'done')<>'hold' then
    raise exception 'completed sales cannot be deleted; void the sale instead';
  end if;
  return old;
end;
$$;

revoke execute on function private.protect_completed_sale_delete() from public,anon,authenticated;

drop trigger if exists protect_completed_sale_delete on public.sales;
create trigger protect_completed_sale_delete
before delete on public.sales
for each row execute function private.protect_completed_sale_delete();

create or replace function private.protect_posted_inventory_document_delete()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  v_data jsonb:=coalesce(old.data,'{}'::jsonb);
  v_posted boolean:=false;
begin
  if tg_table_name in ('goods_receipts','product_returns') then
    v_posted:=coalesce((v_data->>'stockApplied')::boolean,false)
      or coalesce(v_data->>'status','') in ('รับสินค้าแล้ว','ชำระเรียบร้อย','คืนเรียบร้อย');
  elsif tg_table_name='product_exchanges' then
    v_posted:=coalesce((v_data->>'outgoingApplied')::boolean,false)
      or coalesce((v_data->>'incomingApplied')::boolean,false)
      or coalesce(v_data->>'status','') in ('ส่งไปเปลี่ยนแล้ว','รับสินค้ากลับแล้ว');
  elsif tg_table_name='transfers' then
    -- New failed/unposted drafts explicitly store false. Older transfer rows
    -- were posted immediately and did not always include the flag.
    v_posted:=coalesce((v_data->>'stockApplied')::boolean,true);
  end if;

  if v_posted then
    raise exception 'inventory-posted documents cannot be deleted';
  end if;
  return old;
end;
$$;

revoke execute on function private.protect_posted_inventory_document_delete() from public,anon,authenticated;

drop trigger if exists protect_posted_document_delete on public.goods_receipts;
create trigger protect_posted_document_delete before delete on public.goods_receipts
for each row execute function private.protect_posted_inventory_document_delete();

drop trigger if exists protect_posted_document_delete on public.product_returns;
create trigger protect_posted_document_delete before delete on public.product_returns
for each row execute function private.protect_posted_inventory_document_delete();

drop trigger if exists protect_posted_document_delete on public.product_exchanges;
create trigger protect_posted_document_delete before delete on public.product_exchanges
for each row execute function private.protect_posted_inventory_document_delete();

drop trigger if exists protect_posted_document_delete on public.transfers;
create trigger protect_posted_document_delete before delete on public.transfers
for each row execute function private.protect_posted_inventory_document_delete();

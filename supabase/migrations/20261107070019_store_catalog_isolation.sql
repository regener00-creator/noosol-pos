-- Keep existing product IDs, transaction history and quantities. Only the derived barcode index changes.
set local lock_timeout='5s';
lock table public.products in share row exclusive mode;
alter table private.product_barcode_claims add column warehouse_id bigint;
update private.product_barcode_claims c set warehouse_id=coalesce(p.warehouse_id,1) from public.products p where p.id=c.product_id;
alter table private.product_barcode_claims alter column warehouse_id set not null;
alter table private.product_barcode_claims drop constraint product_barcode_unique;
alter table private.product_barcode_claims add constraint product_barcode_unique primary key (barcode,warehouse_id);

create or replace function private.claim_product_barcodes() returns trigger
language plpgsql security definer set search_path='' as $$
declare codes text[]:=private.product_barcode_codes(new.data); code text;
begin
  if auth.uid() is null and current_setting('role',true) in ('anon','authenticated') then raise exception 'not authenticated' using errcode='42501'; end if;
  if tg_op='UPDATE' and old.warehouse_id is not null and old.warehouse_id is distinct from new.warehouse_id then
    raise exception 'ไม่สามารถย้ายสินค้าที่บันทึกแล้วไปคลังอื่น';
  end if;
  if tg_op='UPDATE' and old.warehouse_id is not distinct from new.warehouse_id and codes=private.product_barcode_codes(old.data) then return new; end if;
  delete from private.product_barcode_claims where product_id=new.id and (warehouse_id<>coalesce(new.warehouse_id,1) or not(barcode=any(codes)));
  foreach code in array codes loop
    insert into private.product_barcode_claims as c(warehouse_id,barcode,product_id) values(coalesce(new.warehouse_id,1),code,new.id)
    on conflict on constraint product_barcode_unique do update set product_id=excluded.product_id where c.product_id=excluded.product_id;
    if not found then raise exception 'บาร์โค้ด % ซ้ำกับสินค้าอื่นในคลังนี้',code using errcode='23505',constraint='product_barcode_unique',hint='DUPLICATE_PRODUCT_BARCODE'; end if;
  end loop;
  return new;
end; $$;
drop trigger products_claim_barcodes on public.products;
create trigger products_claim_barcodes after insert or update of data,warehouse_id on public.products for each row execute function private.claim_product_barcodes();

create function public.find_product_barcode_owners(p_codes text[],p_warehouse_id bigint)
returns table(barcode text,product_id bigint,name text,sku text) language sql stable security invoker set search_path='' as $$
 select o.* from public.find_product_barcode_owners(p_codes) o join public.products p on p.id=o.product_id
 where coalesce(p.warehouse_id,1)=p_warehouse_id;
$$;
revoke all on function public.find_product_barcode_owners(text[],bigint) from public,anon;
grant execute on function public.find_product_barcode_owners(text[],bigint) to authenticated;

create policy product_warehouse_visibility on public.products as restrictive for select to authenticated
using (exists (select 1 from public.warehouses w where w.id=coalesce(products.warehouse_id,1)));

-- Covers receipts, counts, returns and direct stock writes including stale clients.
create function private.check_inventory_product_warehouse() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.products p where p.id=new.product_id and coalesce(p.warehouse_id,1)<>new.warehouse_id) then
    raise exception 'สินค้าไม่ได้อยู่ในคลังที่เลือก';
  end if;
  return new;
end; $$;
revoke all on function private.check_inventory_product_warehouse() from public,anon,authenticated;
create trigger check_balance_product_warehouse before insert or update on public.inventory_balances for each row execute function private.check_inventory_product_warehouse();
create trigger check_lot_product_warehouse before insert or update on public.inventory_lots for each row execute function private.check_inventory_product_warehouse();

do $migration$
declare target regprocedure:='public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure;
 definition text:=pg_get_functiondef(target); anchor text:='where product.id = v_product_id';
begin
 if strpos(definition,anchor)=0 then raise exception 'Cannot locate product lookup in complete_sale'; end if;
 definition:=replace(definition,anchor,anchor||' and coalesce(product.warehouse_id,1)=p_warehouse_id');
 anchor:='where promotion.id = v_promotion_id';
 if strpos(definition,anchor)=0 then raise exception 'Cannot locate promotion lookup in complete_sale'; end if;
 execute replace(definition,anchor,anchor||$scope$ and coalesce(promotion.data->>'warehouseId','1')=p_warehouse_id::text$scope$);
end; $migration$;

-- The issuing sequence remains global, while a retired or restored internal number belongs to its store.
alter table private.internal_barcode_history add column warehouse_id bigint not null default 1;
update private.internal_barcode_history h set warehouse_id=p.warehouse_id from public.products p
where h.product_id=p.id and p.warehouse_id is not null and p.warehouse_id<>h.warehouse_id;
alter table private.internal_barcode_history drop constraint internal_barcode_history_pkey;
alter table private.internal_barcode_history add primary key (barcode,warehouse_id);
do $history$
declare definition text:=pg_get_functiondef('private.keep_internal_barcode_history()'::regprocedure);
 insert_anchor text:='internal_barcode_history(barcode,product_id) values(v_code,new.id)';
 read_anchor text:='from private.internal_barcode_history where barcode=v_code';
begin
 if strpos(definition,insert_anchor)=0 or strpos(definition,read_anchor)=0 then raise exception 'Cannot locate internal barcode ownership checks'; end if;
 definition:=replace(definition,insert_anchor,'internal_barcode_history(warehouse_id,barcode,product_id) values(coalesce(new.warehouse_id,1),v_code,new.id)');
 execute replace(definition,read_anchor,read_anchor||' and warehouse_id=coalesce(new.warehouse_id,1)');
end; $history$;

-- Historical transfer documents stay available to backups. Old clients cannot post a new transfer.
revoke execute on function public.apply_inventory_transfer(text) from public,anon,authenticated;
create or replace function public.transfer_inventory_stock(p_product_id bigint,p_from_warehouse_id bigint,p_to_warehouse_id bigint,p_quantity numeric)
returns jsonb language plpgsql set search_path='' as $$
begin raise exception 'ปิดการโอนสินค้าระหว่างคลังแล้ว'; end; $$;

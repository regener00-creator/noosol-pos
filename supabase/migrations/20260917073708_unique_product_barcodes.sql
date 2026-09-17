-- A derived, transactionally maintained registry covers every barcode location,
-- including inactive products. Its unique key arbitrates concurrent devices.
-- No catalog/stock/history data is removed or merged by this migration.
begin;
lock table public.products in share row exclusive mode;

create function private.normalize_product_barcode(p_code text)
returns text language sql immutable parallel safe set search_path='' as $$
  -- Match JavaScript String.trim(), preserving leading zeroes and inner spaces.
  select lower(btrim(coalesce(p_code,''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'));
$$;
create function private.product_barcode_codes(p_data jsonb)
returns text[] language sql immutable parallel safe set search_path='' as $$
  select coalesce(array_agg(distinct code order by code),array[]::text[]) from (
    select private.normalize_product_barcode(value) code from (
      select p_data->>'barcode' value
      union all select case when jsonb_typeof(e)='object' then e->>'code' else e#>>'{}' end
        from jsonb_array_elements(case when jsonb_typeof(p_data->'extraBarcodes')='array' then p_data->'extraBarcodes' else '[]'::jsonb end) e
      union all select e->>'code' from jsonb_array_elements(case when jsonb_typeof(p_data->'vendorBarcodes')='array' then p_data->'vendorBarcodes' else '[]'::jsonb end) e
      union all select e->>'barcode' from jsonb_array_elements(case when jsonb_typeof(p_data->'units')='array' then p_data->'units' else '[]'::jsonb end) e
    ) raw
  ) normalized where code<>'';
$$;
revoke all on function private.normalize_product_barcode(text),private.product_barcode_codes(jsonb) from public,anon,authenticated;

create table private.product_barcode_claims (
  barcode text constraint product_barcode_unique primary key,
  product_id bigint not null references public.products(id) on delete cascade
);
create index product_barcode_claims_product_id_idx on private.product_barcode_claims(product_id);
alter table private.product_barcode_claims enable row level security;
revoke all on private.product_barcode_claims from public,anon,authenticated;
grant select on private.product_barcode_claims to authenticated;
create policy product_barcode_claims_read on private.product_barcode_claims for select to authenticated
  using ((select auth.uid()) is not null);

-- Fail the whole migration if existing data is ambiguous; never choose an owner.
insert into private.product_barcode_claims(barcode,product_id)
  select code,p.id from public.products p cross join lateral unnest(private.product_barcode_codes(p.data)) code;

create function private.claim_product_barcodes()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_codes text[]:=private.product_barcode_codes(new.data);
  v_code text;
begin
  -- Table RLS still controls the catalog write. Only this internal trigger can
  -- mutate claims; clients cannot forge an ownership record or bypass the guard.
  if auth.uid() is null and current_setting('role',true) in ('anon','authenticated') then
    raise exception 'not authenticated' using errcode='42501';
  end if;
  if tg_op='UPDATE' and v_codes=private.product_barcode_codes(old.data) then return new; end if;
  -- Sorted lock acquisition and a real unique index, not a SELECT-then-INSERT
  -- check: even simultaneous transactions cannot claim the same code.
  foreach v_code in array v_codes loop
    insert into private.product_barcode_claims as claims(barcode,product_id) values(v_code,new.id)
    on conflict(barcode) do update set product_id=excluded.product_id
      where claims.product_id=excluded.product_id;
    if not found then
      raise exception 'บาร์โค้ด % มีอยู่ในสินค้าอื่นแล้ว ไม่สามารถบันทึกสินค้าซ้ำได้',v_code
        using errcode='23505',constraint='product_barcode_unique',hint='DUPLICATE_PRODUCT_BARCODE',
          detail=jsonb_build_object('productId',new.id,'barcode',v_code)::text;
    end if;
  end loop;
  delete from private.product_barcode_claims where product_id=new.id and not (barcode=any(v_codes));
  return new;
end;
$$;
revoke all on function private.claim_product_barcodes() from public,anon,authenticated;
create trigger products_claim_barcodes after insert or update of data on public.products
  for each row execute function private.claim_product_barcodes();

-- Read-only preflight for stale clients/imports. RLS on both joined tables is
-- respected. The trigger remains the final authority after this check.
create function public.find_product_barcode_owners(p_codes text[])
returns table(barcode text,product_id bigint,name text,sku text)
language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if coalesce(cardinality(p_codes),0)>10000 then raise exception 'too many barcodes'; end if;
  return query select c.barcode,c.product_id,p.name,p.sku
    from private.product_barcode_claims c join public.products p on p.id=c.product_id
    where c.barcode=any(p_codes) order by c.barcode;
end;
$$;
revoke all on function public.find_product_barcode_owners(text[]) from public,anon,authenticated;
grant execute on function public.find_product_barcode_owners(text[]) to authenticated;
comment on table private.product_barcode_claims is 'Derived barcode ownership, rebuilt by product INSERT triggers during restore; not an additional source of catalog data.';
commit;

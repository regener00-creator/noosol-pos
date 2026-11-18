begin;
-- A read-only estimate. Only assign_price_label_barcodes reserves numbers.
create function private.preview_price_label_barcodes(p_warehouse_id bigint,p_count integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n bigint; code text; codes jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not private.is_current_owner() then
    raise exception 'owner access required' using errcode='42501';
  end if;
  if p_warehouse_id is null or not exists(select 1 from public.warehouses where id=p_warehouse_id)
     or p_count is null or p_count not between 1 and 2000 then
    raise exception 'invalid barcode preview request';
  end if;
  select coalesce((select last_value from private.shop_number_counters
    where warehouse_id=p_warehouse_id and series='internal-label-barcode' and period=''),0) into n;
  while jsonb_array_length(codes)<p_count loop
    n:=n+1;
    if n>99999999999 then raise exception 'barcode counter reached its maximum value'; end if;
    code:=private.shop_letter(p_warehouse_id)||'P'||lpad(n::text,11,'0');
    if not exists(select 1 from private.internal_barcode_history h where h.warehouse_id=p_warehouse_id and h.barcode=lower(code))
       and not exists(select 1 from private.product_barcode_claims c where c.warehouse_id=p_warehouse_id and c.barcode=lower(code)) then
      codes:=codes||jsonb_build_array(code);
    end if;
  end loop;
  return codes;
end $$;
revoke all on function private.preview_price_label_barcodes(bigint,integer) from public,anon;
grant execute on function private.preview_price_label_barcodes(bigint,integer) to authenticated;
create function public.preview_price_label_barcodes(p_warehouse_id bigint,p_count integer)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.preview_price_label_barcodes(p_warehouse_id,p_count);
$$;
revoke all on function public.preview_price_label_barcodes(bigint,integer) from public,anon;
grant execute on function public.preview_price_label_barcodes(bigint,integer) to authenticated;
commit;

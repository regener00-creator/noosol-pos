begin;
-- Preserve permanent ownership. Only the owner can restore a system-issued
-- number to the same product; manually entered/reserved numbers stay retired.
create or replace function private.keep_internal_barcode_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_code text; v_owner bigint; v_old text[]:=array[]::text[];
begin
  if tg_op='UPDATE' then v_old:=private.product_barcode_codes(old.data); end if;
  foreach v_code in array private.product_barcode_codes(new.data) loop
    if v_code !~ '^p[0-9]{11}$' then continue; end if;
    insert into private.internal_barcode_history(barcode,product_id) values(v_code,new.id) on conflict do nothing;
    if not found then
      select product_id into v_owner from private.internal_barcode_history where barcode=v_code;
      if v_owner<>new.id then
        raise exception 'บาร์โค้ด % ถูกใช้แล้วและไม่สามารถนำกลับมาใช้ใหม่ได้',upper(v_code)
          using errcode='23505',hint='INTERNAL_BARCODE_ALREADY_USED';
      end if;
      if tg_op='UPDATE' and not (v_code=any(v_old)) and not (
        auth.uid() is not null and private.is_current_owner() and exists (
          select 1 from private.price_label_requests r
          cross join lateral jsonb_array_elements(r.labels) label
          where label->>'pid'=new.id::text and lower(label->>'barcode')=v_code
            and exists (
              select 1 from jsonb_array_elements(r.payload) requested
              where requested->>'pid'=label->>'pid' and requested->>'unit'=label->>'unit'
                and btrim(coalesce(requested->>'barcode',''))=''
            )
        )
      ) then
        raise exception 'บาร์โค้ด % ถูกใช้แล้ว ต้องเป็นเจ้าของร้านและเลขที่ระบบเคยออกให้สินค้านี้จึงจะนำกลับมาใช้ได้',upper(v_code)
          using errcode='23505',hint='INTERNAL_BARCODE_ALREADY_USED';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_internal_barcode_history() from public,anon,authenticated;
commit;

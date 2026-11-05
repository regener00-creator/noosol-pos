begin;
-- Provenance comes from completed allocation requests, never from a code prefix.
create function public.system_issued_label_codes()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_current_owner() then
    raise exception 'owner access required' using errcode='42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'barcode',barcode)),'[]'::jsonb)
    from (
      select distinct (label->>'pid')::bigint as pid, label->>'barcode' as barcode
      from private.price_label_requests r
      cross join lateral jsonb_array_elements(r.labels) label
      where exists (
        select 1 from jsonb_array_elements(r.payload) requested
        where requested->>'pid'=label->>'pid' and requested->>'unit'=label->>'unit'
          and btrim(coalesce(requested->>'barcode',''))=''
      )
    ) issued
  );
end $$;
revoke all on function public.system_issued_label_codes() from public,anon,authenticated;
grant execute on function public.system_issued_label_codes() to authenticated;
commit;

begin;
-- Read-only, bounded allowlist, and caller RLS. No global counters/locks on
-- checkout. Physical row versions catch updates/deletes even on sales, which
-- has no updated_at/revision column. Rewrites may cause a harmless extra read.
create function public.get_visible_data_signature(p_table text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare result text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_table is null or not (p_table=any(array['sales','quotations','invoices_ar','credit_notes',
    'purchase_orders','goods_receipts','product_exchanges','product_returns','transfers','standalone_tax_invoices'])) then
    raise exception 'unsupported data table' using errcode='22023';
  end if;
  execute format('select md5(coalesce(string_agg(jsonb_build_array(id,xmin::text,ctid::text)::text,'','' order by id),'''')) from public.%I',p_table) into result;
  return result;
end $$;
revoke all on function public.get_visible_data_signature(text) from public,anon;
grant execute on function public.get_visible_data_signature(text) to authenticated;
notify pgrst,'reload schema';
commit;

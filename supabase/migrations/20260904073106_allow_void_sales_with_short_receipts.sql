-- A printed short receipt is an immutable record of a completed sale, but it
-- must not prevent the owner from voiding that sale. The sale row remains in
-- history, its receipt metadata is preserved, and the normal void workflow
-- records the reason, actor, open cash shift, Lot movements, and stock restore.
-- Full tax invoices remain blocked until their tax-document workflow is handled.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.void_sale_core_20260831(text,text)'::regprocedure
  ) into v_definition;

  v_updated := regexp_replace(
    v_definition,
    'if\s+v_sale\.data\s+\?\s+''fullTaxInvoice''\s+or\s+v_sale\.data\s+\?\s+''shortReceiptMeta''\s+then\s+raise exception ''issued sales documents must be handled before voiding'';\s+end if;',
    'if nullif(v_sale.data ->> ''fullTaxInvoice'', '''') is not null then
    raise exception ''full tax invoice must be handled before voiding'';
  end if;',
    'i'
  );

  if v_updated = v_definition then
    raise exception 'void_sale document guard was not found';
  end if;

  execute v_updated;
end;
$migration$;

revoke all on function public.void_sale_core_20260831(text, text)
from public, anon, authenticated, service_role;

comment on function public.void_sale(text, text) is
'Voids a completed sale, including one with a preserved short receipt; full tax invoices remain blocked.';

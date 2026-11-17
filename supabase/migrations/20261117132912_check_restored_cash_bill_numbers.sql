-- A restored receipt can predate the sequence reservations on this server.
do $$
declare body text; marker text:='when ''cashBill'' then exists(select 1 from public.sales where data#>>''{cashReceiptA4Meta,number}''=result)';
begin
  body:=pg_get_functiondef('private.next_shop_number(bigint,text,date,uuid)'::regprocedure);
  if strpos(body,marker)=0 then raise exception 'unexpected cash bill sequence'; end if;
  execute replace(body,marker,marker||' or exists(select 1 from public.standalone_cash_bills where number=result)');
  body:=pg_get_functiondef('public.admin_reset_shop_products(uuid,bigint,text,integer)'::regprocedure);
  if strpos(body,'''standalone_tax_invoices''')=0 then raise exception 'unexpected catalog references'; end if;
  execute replace(body,'''standalone_tax_invoices''','''standalone_tax_invoices'',''standalone_cash_bills''');
end $$;

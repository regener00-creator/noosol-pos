-- Keep the original payment intact and record the actual refund channel in
-- the same atomic state transition which restores stock and assigns a shift.
do $patch$
declare d text; a text;
begin
  select replace(pg_get_functiondef('public.void_sale_core_20260831(text,text)'::regprocedure),E'\r\n',E'\n') into d;
  a:='public.void_sale_core_20260831(p_sale_id text, p_reason text)';
  if position(a in d)=0 then raise exception 'void signature anchor missing'; end if;
  d:=replace(d,a,'private.void_sale_with_refund(p_sale_id text, p_reason text, p_refund_method text)');
  a:=E'  select * into v_sale\n  from public.sales';
  if position(a in d)=0 then raise exception 'void lock anchor missing'; end if;
  d:=replace(d,a,E'  perform private.acquire_store_mutation_gate();\n' || a);
  a:='  update public.sales' || E'\n' || '  set status = ''void'', data = v_data';
  if position(a in d)=0 then raise exception 'void update anchor missing'; end if;
  d:=replace(d,a,$insert$
  if p_refund_method is not null and p_refund_method not in ('เงินสด','โอนธนาคาร','บัตรเครดิต','ออนไลน์') then
    raise exception 'invalid refund method';
  end if;
  v_data := jsonb_set(v_data, '{voidRefundMethod}', to_jsonb(coalesce(p_refund_method,nullif(v_sale.pay_method,''),'ไม่ระบุ')), true);
  update public.sales
  set status = 'void', data = v_data$insert$);
  execute d;
end $patch$;
revoke all on function private.void_sale_with_refund(text,text,text) from public,anon,authenticated,service_role;

-- Retain the old entry point for cached clients, without duplicating the stock
-- restoration logic. A missing refund channel means the original payment.
create or replace function public.void_sale_core_20260831(p_sale_id text,p_reason text)
returns jsonb language sql security definer set search_path=''
as $$ select private.void_sale_with_refund(p_sale_id,p_reason,null); $$;
revoke all on function public.void_sale_core_20260831(text,text) from public,anon,authenticated,service_role;

do $patch$
declare d text; a text;
begin
  select replace(pg_get_functiondef('public.run_stock_operation(uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n') into d;
  a:='public.void_sale(p_args->>''saleId'', p_args->>''reason'')';
  if position(a in d)=0 then raise exception 'void dispatcher anchor missing'; end if;
  -- The private helper holds the store mutation gate; run_stock_operation owns
  -- the durable request. Do not expose another privileged RPC for this feature.
  execute replace(d,a,'private.void_sale_with_refund(p_args->>''saleId'', p_args->>''reason'', p_args->>''refundMethod'')');

  select replace(pg_get_functiondef('public.close_cash_shift_core_20260831(uuid,numeric,text)'::regprocedure),E'\r\n',E'\n') into d;
  a:='select total,pay_method from public.sales where void_shift_id=p_shift_id';
  if position(a in d)=0 then raise exception 'cash refunds anchor missing'; end if;
  d:=replace(d,a,'select total,coalesce(nullif(data->>''voidRefundMethod'',''''),pay_method) as pay_method from public.sales where void_shift_id=p_shift_id');
  a:=E'select coalesce(nullif(s.pay_method,\'\'),\'ไม่ระบุ\'),0::numeric,s.total,0,1\n      from public.sales s where s.void_shift_id=p_shift_id';
  if position(a in d)=0 then raise exception 'refund payment summary anchor missing'; end if;
  d:=replace(d,a,E'select coalesce(nullif(s.data->>\'voidRefundMethod\',\'\'),nullif(s.pay_method,\'\'),\'ไม่ระบุ\'),0::numeric,s.total,0,1\n      from public.sales s where s.void_shift_id=p_shift_id');
  execute d;
end $patch$;

notify pgrst, 'reload schema';

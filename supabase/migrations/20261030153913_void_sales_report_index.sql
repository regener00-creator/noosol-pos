-- Range scans use the existing immutable cancellation metadata, not sale_date.
-- Index only cancelled bills; no duplicate transaction or stock records.
create index if not exists sales_voided_at_report_idx
on public.sales ((data->>'voidedAt'),id) where status='void';

-- Snapshot the actor name for future cancellations so later employee renames
-- or removals do not erase the human-readable cancellation history.
do $patch$
declare d text; a text;
begin
  select replace(pg_get_functiondef('private.void_sale_with_refund(text,text,text)'::regprocedure),E'\r\n',E'\n') into d;
  a:=E'  update public.sales\n  set status = ''void'', data = v_data';
  if position(a in d)=0 then raise exception 'void report metadata anchor missing'; end if;
  d:=replace(d,a,$insert$
  v_data := jsonb_set(v_data, '{voidedByName}', to_jsonb(coalesce(
    (select coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.username)
     from public.profiles p where p.id=(select auth.uid())), 'ไม่ระบุ')), true);
  update public.sales
  set status = 'void', data = v_data$insert$);
  execute d;
end $patch$;

-- A group's starting price is the first step when the group has a flat price.
do $migration$
declare
  definition text:=pg_get_functiondef('public.save_store_price_group(bigint,jsonb,jsonb)'::regprocedure);
  anchor text:='perform private.check_contract_steps(rule,p_warehouse_id);';
begin
  if strpos(definition,anchor)=0 then raise exception 'unexpected group save definition'; end if;
  execute replace(definition,anchor,anchor||$guard$
    if rule->>'price' is not null and exists (
      select from jsonb_array_elements(rule->'tiers') step
      where (step->>'price')::numeric >= (rule->>'price')::numeric
    ) then
      raise exception 'ราคาขั้นบันไดต้องต่ำกว่าราคาตั้งต้นของกลุ่ม % บาท',rule->>'price';
    end if;$guard$);
end $migration$;

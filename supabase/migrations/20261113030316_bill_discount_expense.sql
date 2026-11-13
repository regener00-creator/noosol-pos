-- The sale's payment and tax already reflect the discount. Include the manual
-- portion in reported costs, but subtract only merchandise cost from net sales.
-- Keep it outside merchandise items so stock, returns and loyalty remain valid.
do $migration$
declare
  definition text := pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure);
  cost_anchor text := 'v_cost_total_sum := round(v_cost_total_sum, 6);';
  profit_anchor text := 'round(v_before_vat - v_cost_total_sum, 2)';
begin
  if strpos(definition,cost_anchor)=0 or strpos(definition,profit_anchor)=0 then
    raise exception 'Unexpected complete_sale cost calculation';
  end if;
  definition := replace(definition, cost_anchor, $sql$
    v_cost_total_sum := round(v_cost_total_sum, 6);
    if v_sale_data ? 'billDiscountCost' then
      if not private.is_safe_nonnegative_decimal(v_sale_data->>'billDiscountCost')
         or (v_sale_data->>'billDiscountCost')::numeric is distinct from
            round(v_discount - coalesce((v_sale_data->>'loyaltyRedeemed')::numeric,0), 2) then
        raise exception 'bill discount expense does not match manual discount';
      end if;
      v_cost_total_sum := v_cost_total_sum + (v_sale_data->>'billDiscountCost')::numeric;
    end if;
  $sql$);
  execute replace(definition, profit_anchor,
    'round(v_before_vat - v_cost_total_sum + coalesce((v_sale_data->>''billDiscountCost'')::numeric,0), 2)');
end;
$migration$;

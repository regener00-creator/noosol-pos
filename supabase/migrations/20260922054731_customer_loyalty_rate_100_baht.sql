-- New sales earn one point for every 100 baht of the final net total.
-- Historical sale snapshots remain unchanged so prior balances are preserved.
create or replace function private.finalize_sale_loyalty(p_sale jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v_id text; v_customer_id bigint; v_redeem numeric; v_earned numeric; v_state jsonb; v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'LOYALTY_ACCESS_DENIED' using errcode='42501'; end if;
  if coalesce(p_sale->>'loyaltyRedeemed','0') !~ '^[0-9]{1,10}$' then raise exception 'LOYALTY_INVALID_POINTS'; end if;
  v_redeem:=coalesce((p_sale->>'loyaltyRedeemed')::numeric,0);
  p_sale:=p_sale-'loyalty';
  v_id:=coalesce(nullif(p_sale->>'customerId',''),p_sale->'member'->>'id');
  if v_id is null then
    if v_redeem>0 then raise exception 'LOYALTY_CUSTOMER_REQUIRED'; end if;
    return p_sale-'loyaltyRedeemed';
  end if;
  if v_id !~ '^[0-9]{1,18}$' then raise exception 'LOYALTY_CUSTOMER_NOT_FOUND'; end if;
  v_customer_id:=v_id::bigint;
  perform 1 from public.contacts where id=v_customer_id and type in ('customer','both') for update;
  if not found then raise exception 'LOYALTY_CUSTOMER_NOT_FOUND'; end if;
  v_now:=clock_timestamp();
  v_state:=private.customer_loyalty_snapshot(v_customer_id,v_now);
  if v_redeem>0 then
    if nullif(p_sale->>'loyaltyPeriodStart','') is distinct from v_state->>'periodStart' then raise exception 'LOYALTY_CYCLE_CHANGED'; end if;
    if (p_sale->>'total')::numeric+v_redeem-(p_sale->>'fee')::numeric<1000 then raise exception 'LOYALTY_MINIMUM_1000'; end if;
    if v_redeem>(p_sale->>'discount')::numeric then raise exception 'LOYALTY_DISCOUNT_MISMATCH'; end if;
    if v_redeem>(v_state->>'balance')::numeric then raise exception 'LOYALTY_INSUFFICIENT_POINTS'; end if;
  end if;
  v_earned:=floor((p_sale->>'total')::numeric/100);
  return p_sale||jsonb_build_object('customerId',v_customer_id::text,'loyaltyRedeemed',v_redeem,
    'loyalty',jsonb_build_object('customerId',v_customer_id::text,'earned',v_earned,'redeemed',v_redeem,
      'periodStart',v_state->>'periodStart','expiresOn',v_state->>'expiresOn','recordedAt',v_now,
      'balanceAfter',greatest(0,(v_state->>'balance')::numeric-(v_state->>'adjustmentDue')::numeric-v_redeem+v_earned)));
end $$;

revoke all on function private.finalize_sale_loyalty(jsonb) from public,anon,authenticated;

-- Customer-specific prices are stored with the customer master row. Checkout
-- must resolve that server-side source of truth instead of trusting the price
-- supplied by the browser, while still allowing the ordinary catalog-price
-- guard to protect standard sales.

create or replace function private.resolve_customer_special_price(
  p_sale jsonb,
  p_item jsonb,
  p_product_id bigint,
  p_unit_name text
) returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_customer_id bigint;
  v_rule_id text;
  v_match_count integer;
  v_price numeric;
begin
  if coalesce(p_item ->> 'priceSource', '') <> 'customer' then
    raise exception 'invalid customer special price source';
  end if;

  if coalesce(p_sale ->> 'customerId', '') !~ '^[0-9]{1,18}$' then
    raise exception 'customer special price requires a customer';
  end if;
  v_customer_id := (p_sale ->> 'customerId')::bigint;
  v_rule_id := nullif(btrim(coalesce(p_item ->> 'customerPriceRuleId', '')), '');
  if v_rule_id is null or char_length(v_rule_id) > 200 then
    raise exception 'invalid customer special price rule';
  end if;

  select
    count(*),
    max((rule.value ->> 'price')::numeric)
  into v_match_count, v_price
  from public.contacts contact
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(contact.data -> 'customerPrices') = 'array'
      then contact.data -> 'customerPrices' else '[]'::jsonb end
  ) rule(value)
  where contact.id = v_customer_id
    and contact.type in ('customer', 'both')
    and rule.value ->> 'id' = v_rule_id
    and rule.value ->> 'productId' = p_product_id::text
    and btrim(coalesce(rule.value ->> 'unit', '')) = p_unit_name
    and private.is_safe_nonnegative_decimal(rule.value ->> 'price');

  if v_match_count <> 1 or v_price is null then
    raise exception 'customer special price changed; refresh the cart';
  end if;
  return v_price;
end;
$$;

revoke all on function private.resolve_customer_special_price(
  jsonb, jsonb, bigint, text
) from public, anon, authenticated;

-- The hardened checkout routine is intentionally large. Patch only its exact
-- catalog-price guard and fail the migration if the expected predecessor is
-- not present, so a future schema change can never silently weaken checkout.
do $migration$
declare
  v_definition text;
  v_anchor text := $anchor$      else
        if abs(v_price - v_expected_price) > 0.005 then
          raise exception 'product price changed; refresh the cart';
        end if;$anchor$;
  v_replacement text := $replacement$      else
        if coalesce(v_item ->> 'priceSource', 'standard') = 'customer' then
          if v_promotion_id is not null then
            raise exception 'customer special price cannot be combined with a promotion';
          end if;
          v_expected_price := private.resolve_customer_special_price(
            v_sale_data, v_item, v_product_id, v_unit_name
          );
        end if;
        if abs(v_price - v_expected_price) > 0.005 then
          raise exception 'product price changed; refresh the cart';
        end if;$replacement$;
begin
  select pg_get_functiondef(
    'public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure
  ) into v_definition;

  if position('private.resolve_customer_special_price(' in v_definition) > 0 then
    return;
  end if;
  if position(v_anchor in v_definition) = 0 then
    raise exception 'complete_sale price guard does not match the expected version';
  end if;

  v_definition := replace(v_definition, v_anchor, v_replacement);
  execute v_definition;
end;
$migration$;

revoke execute on function public.complete_sale(
  uuid, text, bigint, jsonb, jsonb, text
) from public, anon;
grant execute on function public.complete_sale(
  uuid, text, bigint, jsonb, jsonb, text
) to authenticated;

comment on function private.resolve_customer_special_price(
  jsonb, jsonb, bigint, text
) is 'Returns one server-authorized customer/product/unit price rule for atomic checkout.';

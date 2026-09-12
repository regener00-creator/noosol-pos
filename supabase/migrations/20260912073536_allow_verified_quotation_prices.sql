-- Resolve quoted prices from the saved document, never from a browser flag.
-- Keep this helper private: complete_sale supplies authentication, warehouse
-- authorization, ordered inventory locks, totals, and idempotency checks.
create or replace function private.resolve_quotation_price(
  p_sale jsonb, p_item jsonb, p_product_id bigint, p_unit_name text
) returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id text := nullif(btrim(p_item ->> 'sourceQuotationId'), '');
  v_quote jsonb;
  v_index integer;
  v_prices integer;
  v_price numeric;
  v_customer_id text;
begin
  if coalesce(p_item ->> 'priceSource', '') <> 'quotation'
     or v_id is null or char_length(v_id) > 200
     or v_id is distinct from nullif(btrim(p_sale ->> 'sourceQuotationId'), '') then
    raise exception 'quotation source does not match the sale';
  end if;
  select q.data into v_quote from public.quotations q where q.id = v_id for share;
  if not found or jsonb_typeof(v_quote -> 'items') is distinct from 'array'
     or lower(coalesce(v_quote ->> 'status', '')) in ('cancelled', 'canceled', 'ยกเลิก') then
    raise exception 'quotation is unavailable; reopen quotation';
  end if;

  v_customer_id := nullif(btrim(v_quote #>> '{customerInfo,id}'), '');
  if v_customer_id is not null then
    if v_customer_id is distinct from nullif(btrim(p_sale ->> 'customerId'), '') then
      raise exception 'quotation customer changed; reopen quotation';
    end if;
  elsif coalesce(nullif(btrim(v_quote ->> 'customer'), ''), btrim(v_quote #>> '{customerInfo,name}'), '')
        is distinct from coalesce(btrim(p_sale ->> 'customerName'), '') then
    raise exception 'quotation customer changed; reopen quotation';
  end if;

  if p_item ->> 'sourceQuotationLineIndex' is not null then
    if p_item ->> 'sourceQuotationLineIndex' !~ '^[0-9]{1,6}$' then
      raise exception 'invalid quotation line; reopen quotation';
    end if;
    v_index := (p_item ->> 'sourceQuotationLineIndex')::integer;
  end if;

  -- Older held carts have no line index. Accept them only when the matching
  -- product/unit has one unambiguous price. Name matching is legacy-only and
  -- must never override an explicit (possibly deleted) product ID.
  select count(distinct prices.price), max(prices.price) into v_prices, v_price
  from (
    select case when private.is_safe_nonnegative_decimal(line.value ->> 'price')
      then (line.value ->> 'price')::numeric end as price
    from jsonb_array_elements(v_quote -> 'items') with ordinality as line(value, ord)
    where (v_index is null or line.ord = v_index + 1)
      and btrim(coalesce(line.value ->> 'unit', '')) = p_unit_name
      and (
        coalesce(nullif(line.value ->> 'productId', ''), nullif(line.value ->> 'pid', '')) = p_product_id::text
        or (
          coalesce(nullif(line.value ->> 'productId', ''), nullif(line.value ->> 'pid', '')) is null
          and exists (select 1 from public.products product where product.id = p_product_id
                      and product.name = line.value ->> 'name')
        )
      )
  ) prices;
  if v_prices <> 1 or v_price is null or v_price > 1000000000000 then
    raise exception 'quotation product, unit or price changed; reopen quotation';
  end if;
  if not private.is_safe_nonnegative_decimal(p_item ->> 'price')
     or abs((p_item ->> 'price')::numeric - v_price) > 0.005 then
    raise exception 'quotation price changed; reopen quotation';
  end if;
  return v_price;
end;
$$;

revoke all on function private.resolve_quotation_price(jsonb,jsonb,bigint,text)
  from public, anon, authenticated;

-- Minimal, fail-closed patch preserves all existing checkout/loyalty guards.
-- Resolve BEFORE the free-promotion branch so an explicitly quoted zero price
-- is allowed without pretending it is a promotional giveaway.
do $migration$
declare
  v_definition text;
  v_price_anchor text := $anchor$      if v_price = 0 and v_expected_price > 0 then$anchor$;
  v_custom_anchor text := $anchor$    if v_is_custom then$anchor$;
  v_price_patch text := $patch$      if coalesce(v_item ->> 'priceSource', 'standard') = 'quotation' then
        if v_promotion_id is not null then
          raise exception 'quotation price cannot be combined with a promotion';
        end if;
        v_expected_price := private.resolve_quotation_price(
          v_sale_data, v_item, v_product_id, v_unit_name
        );
      end if;

      if v_price = 0 and v_expected_price > 0 then$patch$;
  v_custom_patch text := $patch$    if v_is_custom and coalesce(v_item ->> 'priceSource', '') = 'quotation' then
      raise exception 'quotation requires a catalog product';
    end if;
    if v_is_custom then$patch$;
begin
  select pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure)
    into v_definition;
  if position('private.resolve_quotation_price(' in v_definition) > 0 then return; end if;
  if position('private.resolve_customer_special_price(' in v_definition) = 0
     or position(v_price_anchor in v_definition) = 0
     or position(v_custom_anchor in v_definition) = 0 then
    raise exception 'complete_sale quotation price guard does not match the expected version';
  end if;
  execute replace(replace(v_definition, v_price_anchor, v_price_patch), v_custom_anchor, v_custom_patch);
end;
$migration$;

revoke execute on function public.complete_sale(uuid,text,bigint,jsonb,jsonb,text) from public, anon;
grant execute on function public.complete_sale(uuid,text,bigint,jsonb,jsonb,text) to authenticated;
comment on function private.resolve_quotation_price(jsonb,jsonb,bigint,text)
  is 'Validates quotation/customer/product/unit/line and returns the saved price for atomic checkout.';

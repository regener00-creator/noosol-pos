-- A representative can quote several products in one visit. Keep the shared
-- activity header in notes and normalize the quoted products into child rows.
-- The first item is mirrored to the legacy notes columns so older clients and
-- exports continue to work while all current clients use this table.

create table public.representative_activity_items (
  id bigint generated always as identity primary key,
  note_id uuid not null references public.notes(id) on delete cascade,
  product_id bigint references public.products(id) on delete set null,
  product_name text not null,
  quoted_price numeric(14,2),
  minimum_quantity numeric(14,4),
  unit text,
  condition_note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint representative_activity_items_product_name_length check (
    char_length(btrim(product_name)) between 1 and 300
  ),
  constraint representative_activity_items_quoted_price_check check (
    quoted_price is null or quoted_price >= 0
  ),
  constraint representative_activity_items_minimum_quantity_check check (
    minimum_quantity is null or minimum_quantity > 0
  ),
  constraint representative_activity_items_unit_length check (
    unit is null or char_length(unit) <= 120
  ),
  constraint representative_activity_items_condition_length check (
    condition_note is null or char_length(condition_note) <= 1000
  ),
  constraint representative_activity_items_sort_order_check check (sort_order >= 0),
  constraint representative_activity_items_note_sort_unique unique (note_id,sort_order)
);

create unique index representative_activity_items_note_product_uidx
  on public.representative_activity_items(note_id,product_id)
  where product_id is not null;

create index representative_activity_items_product_note_idx
  on public.representative_activity_items(product_id,note_id)
  where product_id is not null;

alter table public.representative_activity_items enable row level security;

revoke all on table public.representative_activity_items from public,anon,authenticated;
revoke all on sequence public.representative_activity_items_id_seq from public,anon,authenticated;
grant select on table public.representative_activity_items to authenticated;
grant all on table public.representative_activity_items to service_role;
grant all on sequence public.representative_activity_items_id_seq to service_role;

create policy representative_activity_items_read
on public.representative_activity_items
for select to authenticated
using (
  exists (
    select 1
    from public.notes note
    where note.id = representative_activity_items.note_id
  )
);

-- Preserve every existing one-product representative activity.
insert into public.representative_activity_items(
  note_id,product_id,product_name,quoted_price,minimum_quantity,unit,sort_order
)
select
  note.id,
  note.product_id,
  product.name,
  note.quoted_price,
  note.minimum_quantity,
  nullif(btrim(note.unit),''),
  0
from public.notes note
join public.products product on product.id = note.product_id
where note.activity_type is not null
  and note.product_id is not null
on conflict (note_id,product_id) where product_id is not null do nothing;

create or replace function public.save_representative_activity(
  p_note_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_content_html text,
  p_representative_id bigint,
  p_activity_type text,
  p_event_date date,
  p_valid_from date,
  p_valid_to date,
  p_reminder_date date,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner boolean := (select private.is_current_owner());
  v_note public.notes%rowtype;
  v_note_id uuid;
  v_item jsonb;
  v_item_count integer := 0;
  v_sort_order integer := 0;
  v_product_id bigint;
  v_product_name text;
  v_quoted_price numeric(14,2);
  v_minimum_quantity numeric(14,4);
  v_unit text;
  v_condition_note text;
  v_first_product_id bigint;
  v_first_quoted_price numeric(14,2);
  v_first_minimum_quantity numeric(14,4);
  v_first_unit text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_representative_id is null then
    raise exception 'representative is required';
  end if;
  if p_event_date is null then
    raise exception 'event date is required';
  end if;
  if p_activity_type is null or p_activity_type not in (
    'promotion','price_quote','contact','purchase_order',
    'goods_receipt','product_return','general'
  ) then
    raise exception 'unsupported activity type';
  end if;
  if p_valid_from is not null and p_valid_to is not null and p_valid_to < p_valid_from then
    raise exception 'invalid promotion date range';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too many activity items';
  end if;

  -- Validate all values before writing anything, and capture the first row for
  -- compatibility with the former one-product note columns.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'productId','')::bigint;
    if v_product_id is null then
      raise exception 'product is required for every item';
    end if;
    select product.name
      into v_product_name
    from public.products product
    where product.id = v_product_id;
    if not found then
      raise exception 'product % was not found',v_product_id;
    end if;

    v_quoted_price := nullif(v_item->>'quotedPrice','')::numeric;
    v_minimum_quantity := nullif(v_item->>'minimumQuantity','')::numeric;
    v_unit := nullif(btrim(coalesce(v_item->>'unit','')),'');
    v_condition_note := nullif(btrim(coalesce(v_item->>'conditionNote','')),'');
    if v_quoted_price is not null and v_quoted_price < 0 then
      raise exception 'quoted price must not be negative';
    end if;
    if v_minimum_quantity is not null and v_minimum_quantity <= 0 then
      raise exception 'minimum quantity must be greater than zero';
    end if;
    if char_length(coalesce(v_unit,'')) > 120 then
      raise exception 'unit is too long';
    end if;
    if char_length(coalesce(v_condition_note,'')) > 1000 then
      raise exception 'item condition is too long';
    end if;

    v_item_count := v_item_count + 1;
    if v_item_count = 1 then
      v_first_product_id := v_product_id;
      v_first_quoted_price := v_quoted_price;
      v_first_minimum_quantity := v_minimum_quantity;
      v_first_unit := v_unit;
    end if;
  end loop;

  if p_note_id is null then
    if not (select public.can_current_user_page('notes',null,'create')) then
      raise exception 'note create permission required';
    end if;
    insert into public.notes(
      title,content_html,hidden_from_level2,representative_id,product_id,
      activity_type,event_date,valid_from,valid_to,quoted_price,
      minimum_quantity,unit,reminder_date
    ) values (
      p_title,coalesce(p_content_html,''),false,p_representative_id,v_first_product_id,
      p_activity_type,p_event_date,p_valid_from,p_valid_to,v_first_quoted_price,
      v_first_minimum_quantity,v_first_unit,p_reminder_date
    ) returning id into v_note_id;
  else
    select note.* into v_note
    from public.notes note
    where note.id = p_note_id
    for update;
    if not found or v_note.activity_type is null then
      raise exception 'representative activity was not found';
    end if;
    if not v_owner and not (
      v_note.created_by = v_actor
      and v_note.hidden_from_level2 is false
      and (select public.can_current_user_page('notes',null,'edit'))
    ) then
      raise exception 'note edit permission required';
    end if;
    if p_expected_updated_at is null or v_note.updated_at is distinct from p_expected_updated_at then
      raise exception 'representative activity was changed by another device';
    end if;

    update public.notes
    set title = p_title,
        content_html = coalesce(p_content_html,''),
        representative_id = p_representative_id,
        product_id = v_first_product_id,
        activity_type = p_activity_type,
        event_date = p_event_date,
        valid_from = p_valid_from,
        valid_to = p_valid_to,
        quoted_price = v_first_quoted_price,
        minimum_quantity = v_first_minimum_quantity,
        unit = v_first_unit,
        reminder_date = p_reminder_date
    where id = p_note_id;
    v_note_id := p_note_id;
  end if;

  delete from public.representative_activity_items item
  where item.note_id = v_note_id;

  v_sort_order := 0;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::bigint;
    select product.name,coalesce(nullif(btrim(v_item->>'unit'),''),nullif(btrim(product.unit),''))
      into v_product_name,v_unit
    from public.products product
    where product.id = v_product_id;
    v_quoted_price := nullif(v_item->>'quotedPrice','')::numeric;
    v_minimum_quantity := nullif(v_item->>'minimumQuantity','')::numeric;
    v_condition_note := nullif(btrim(coalesce(v_item->>'conditionNote','')),'');

    insert into public.representative_activity_items(
      note_id,product_id,product_name,quoted_price,minimum_quantity,
      unit,condition_note,sort_order
    ) values (
      v_note_id,v_product_id,v_product_name,v_quoted_price,v_minimum_quantity,
      v_unit,v_condition_note,v_sort_order
    );
    v_sort_order := v_sort_order + 1;
  end loop;

  return v_note_id;
end;
$$;

revoke all on function public.save_representative_activity(
  uuid,timestamptz,text,text,bigint,text,date,date,date,date,jsonb
) from public,anon;
grant execute on function public.save_representative_activity(
  uuid,timestamptz,text,text,bigint,text,date,date,date,date,jsonb
) to authenticated,service_role;

comment on table public.representative_activity_items is
'Products quoted or promoted together in one representative activity note.';
comment on function public.save_representative_activity(
  uuid,timestamptz,text,text,bigint,text,date,date,date,date,jsonb
) is 'Atomically saves a representative activity header and all product line items.';

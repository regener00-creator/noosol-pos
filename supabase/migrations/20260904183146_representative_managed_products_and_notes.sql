-- Keep the products handled by each sales representative independent from
-- individual NOTE entries. A representative can have many products and many
-- dated notes, while each product can be handled by several representatives.

create table public.sales_representative_products (
  representative_id bigint not null
    references public.sales_representatives(id) on delete cascade,
  product_id bigint not null
    references public.products(id) on delete cascade,
  created_by uuid default auth.uid()
    references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (representative_id,product_id)
);

create index sales_representative_products_product_rep_idx
  on public.sales_representative_products(product_id,representative_id);

alter table public.sales_representative_products enable row level security;

revoke all on table public.sales_representative_products
  from public,anon,authenticated;
grant select on table public.sales_representative_products to authenticated;
grant all on table public.sales_representative_products to service_role;

create policy sales_representative_products_read
on public.sales_representative_products
for select to authenticated
using (
  (select private.is_current_owner())
  or (select public.can_current_user_page('notes',null,'view'))
  or (select public.can_current_user_page('salesreps',null,'view'))
);

-- Carry forward products already recorded in the former activity-item model.
insert into public.sales_representative_products(representative_id,product_id,created_by)
select distinct note.representative_id,item.product_id,note.created_by
from public.notes note
join public.representative_activity_items item on item.note_id = note.id
where note.activity_type is not null
  and note.representative_id is not null
  and item.product_id is not null
on conflict (representative_id,product_id) do nothing;

insert into public.sales_representative_products(representative_id,product_id,created_by)
select distinct note.representative_id,note.product_id,note.created_by
from public.notes note
where note.activity_type is not null
  and note.representative_id is not null
  and note.product_id is not null
on conflict (representative_id,product_id) do nothing;

create or replace function public.save_representative_note(
  p_note_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_content_html text,
  p_representative_id bigint,
  p_event_date date,
  p_product_ids jsonb
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
  v_product_id bigint;
  v_product_count integer;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_representative_id is null then
    raise exception 'representative is required';
  end if;
  if p_event_date is null then
    raise exception 'note date is required';
  end if;
  if char_length(btrim(coalesce(p_title,''))) not between 1 and 160 then
    raise exception 'note title must contain 1 to 160 characters';
  end if;
  if char_length(coalesce(p_content_html,'')) > 100000 then
    raise exception 'note content is too long';
  end if;
  if p_product_ids is null or jsonb_typeof(p_product_ids) <> 'array' then
    raise exception 'product ids must be an array';
  end if;
  if jsonb_array_length(p_product_ids) < 1 then
    raise exception 'at least one managed product is required';
  end if;
  if jsonb_array_length(p_product_ids) > 500 then
    raise exception 'too many managed products';
  end if;
  if not exists (
    select 1 from public.sales_representatives representative
    where representative.id = p_representative_id
  ) then
    raise exception 'representative was not found';
  end if;

  select count(distinct value::bigint)
    into v_product_count
  from jsonb_array_elements_text(p_product_ids);
  if v_product_count <> jsonb_array_length(p_product_ids) then
    raise exception 'managed products must not be duplicated';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_product_ids) requested(value)
    left join public.products product on product.id = requested.value::bigint
    where product.id is null
  ) then
    raise exception 'one or more products were not found';
  end if;

  if p_note_id is null then
    if not (select public.can_current_user_page('notes',null,'create')) then
      raise exception 'note create permission required';
    end if;
    insert into public.notes(
      title,content_html,hidden_from_level2,representative_id,
      activity_type,event_date,product_id,valid_from,valid_to,
      quoted_price,minimum_quantity,unit,reminder_date
    ) values (
      btrim(p_title),coalesce(p_content_html,''),false,p_representative_id,
      'general',p_event_date,null,null,null,null,null,null,null
    ) returning id into v_note_id;
  else
    select note.* into v_note
    from public.notes note
    where note.id = p_note_id
    for update;
    if not found or v_note.activity_type is null then
      raise exception 'representative note was not found';
    end if;
    if not v_owner and not (
      v_note.created_by = v_actor
      and v_note.hidden_from_level2 is false
      and (select public.can_current_user_page('notes',null,'edit'))
    ) then
      raise exception 'note edit permission required';
    end if;
    if p_expected_updated_at is null
       or v_note.updated_at is distinct from p_expected_updated_at then
      raise exception 'representative note was changed by another device';
    end if;

    update public.notes
    set title = btrim(p_title),
        content_html = coalesce(p_content_html,''),
        representative_id = p_representative_id,
        activity_type = 'general',
        event_date = p_event_date,
        product_id = null,
        valid_from = null,
        valid_to = null,
        quoted_price = null,
        minimum_quantity = null,
        unit = null,
        reminder_date = null
    where id = p_note_id;
    v_note_id := p_note_id;
  end if;

  -- Product responsibility is current master data for the representative, so
  -- each save replaces that representative's set in the same transaction.
  delete from public.sales_representative_products assignment
  where assignment.representative_id = p_representative_id;

  for v_product_id in
    select distinct value::bigint
    from jsonb_array_elements_text(p_product_ids)
  loop
    insert into public.sales_representative_products(
      representative_id,product_id,created_by
    ) values (
      p_representative_id,v_product_id,v_actor
    );
  end loop;

  delete from public.representative_activity_items item
  where item.note_id = v_note_id;

  return v_note_id;
end;
$$;

revoke all on function public.save_representative_note(
  uuid,timestamptz,text,text,bigint,date,jsonb
) from public,anon;
grant execute on function public.save_representative_note(
  uuid,timestamptz,text,text,bigint,date,jsonb
) to authenticated,service_role;

comment on table public.sales_representative_products is
'Current products handled by each sales representative, independent of dated notes.';
comment on function public.save_representative_note(
  uuid,timestamptz,text,text,bigint,date,jsonb
) is 'Atomically saves a representative NOTE and replaces that representative managed-product list.';

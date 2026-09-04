-- Save representative NOTE entries independently from the representative's
-- current managed-product list. Product assignments have their own atomic RPC.

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
  if not exists (
    select 1 from public.sales_representatives representative
    where representative.id = p_representative_id
  ) then
    raise exception 'representative was not found';
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

comment on function public.save_representative_note(
  uuid,timestamptz,text,text,bigint,date,jsonb
) is 'Atomically saves one representative NOTE without changing the representative managed-product list.';

create or replace function public.save_representative_products(
  p_representative_id bigint,
  p_product_ids jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_product_id bigint;
  v_product_count integer;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if not (
    (select private.is_current_owner())
    or (select public.can_current_user_page('salesreps',null,'edit'))
  ) then
    raise exception 'representative edit permission required';
  end if;
  if p_representative_id is null or not exists (
    select 1 from public.sales_representatives representative
    where representative.id = p_representative_id
  ) then
    raise exception 'representative was not found';
  end if;
  if p_product_ids is null or jsonb_typeof(p_product_ids) <> 'array' then
    raise exception 'product ids must be an array';
  end if;
  if jsonb_array_length(p_product_ids) > 500 then
    raise exception 'too many managed products';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_product_ids) requested(value)
    where requested.value !~ '^[0-9]+$'
  ) then
    raise exception 'product ids must be positive integers';
  end if;
  select count(distinct requested.value::bigint)
    into v_product_count
  from jsonb_array_elements_text(p_product_ids) requested(value);
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

  delete from public.sales_representative_products assignment
  where assignment.representative_id = p_representative_id;

  for v_product_id in
    select requested.value::bigint
    from jsonb_array_elements_text(p_product_ids) requested(value)
  loop
    insert into public.sales_representative_products(
      representative_id,product_id,created_by
    ) values (
      p_representative_id,v_product_id,v_actor
    );
  end loop;

  return v_product_count;
end;
$$;

revoke all on function public.save_representative_products(bigint,jsonb)
  from public,anon;
grant execute on function public.save_representative_products(bigint,jsonb)
  to authenticated,service_role;

comment on function public.save_representative_products(bigint,jsonb) is
'Atomically replaces the current products handled by one sales representative.';

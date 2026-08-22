-- Product exchange documents and atomic, idempotent stock posting.

create table if not exists public.product_exchanges (
  id text primary key,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_exchanges enable row level security;

revoke all on public.product_exchanges from anon;
grant select, insert, update, delete on public.product_exchanges to authenticated;
grant all on public.product_exchanges to service_role;

drop policy if exists product_exchanges_read on public.product_exchanges;
create policy product_exchanges_read on public.product_exchanges
for select to authenticated
using (created_by = (select auth.uid()) or (select private.is_current_owner()));

drop policy if exists product_exchanges_insert on public.product_exchanges;
create policy product_exchanges_insert on public.product_exchanges
for insert to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists product_exchanges_update on public.product_exchanges;
create policy product_exchanges_update on public.product_exchanges
for update to authenticated
using (created_by = (select auth.uid()) or (select private.is_current_owner()))
with check (created_by = (select auth.uid()) or (select private.is_current_owner()));

drop policy if exists product_exchanges_delete on public.product_exchanges;
create policy product_exchanges_delete on public.product_exchanges
for delete to authenticated
using (created_by = (select auth.uid()) or (select private.is_current_owner()));

create index if not exists idx_product_exchanges_created_by
on public.product_exchanges(created_by);

create or replace function public.apply_product_exchange_status(p_exchange_id text, p_next_status text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.product_exchanges%rowtype;
  v_data jsonb;
  v_item jsonb;
  v_pid bigint;
  v_qty numeric;
  v_expiry text;
  v_status text;
  v_outgoing_applied boolean;
  v_incoming_applied boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  if p_next_status not in ('ส่งไปเปลี่ยนแล้ว','รับสินค้ากลับแล้ว') then
    raise exception 'invalid product exchange status';
  end if;

  select * into v_row
  from public.product_exchanges
  where id = p_exchange_id
  for update;

  if not found then
    raise exception 'product exchange document not found';
  end if;

  v_data := coalesce(v_row.data,'{}'::jsonb);
  v_status := coalesce(v_data->>'status','ร่าง');
  v_outgoing_applied := coalesce((v_data->>'outgoingApplied')::boolean,false);
  v_incoming_applied := coalesce((v_data->>'incomingApplied')::boolean,false);

  if v_incoming_applied then
    return jsonb_build_object('exchange',v_data);
  end if;

  if not v_outgoing_applied then
    for v_item in select value from jsonb_array_elements(coalesce(v_data->'outgoingItems','[]'::jsonb))
    loop
      v_pid := nullif(v_item->>'pid','')::bigint;
      v_qty := coalesce(nullif(v_item->>'baseQty','')::numeric,
        coalesce(nullif(v_item->>'qty','')::numeric,0) * coalesce(nullif(v_item->>'factor','')::numeric,1));
      if v_pid is null or v_qty <= 0 then
        raise exception 'invalid outgoing product exchange item';
      end if;
      update public.products
      set stock = coalesce(stock,0) - v_qty,
          updated_at = now()
      where id = v_pid and coalesce(stock,0) >= v_qty;
      if not found then
        raise exception 'insufficient stock for product %', v_pid;
      end if;
    end loop;
    v_outgoing_applied := true;
    v_data := jsonb_set(v_data,'{outgoingApplied}','true'::jsonb,true);
    v_data := jsonb_set(v_data,'{outgoingAppliedAt}',to_jsonb(now()::text),true);
  end if;

  if p_next_status = 'รับสินค้ากลับแล้ว' and not v_incoming_applied then
    if jsonb_array_length(coalesce(v_data->'incomingItems','[]'::jsonb)) = 0 then
      raise exception 'incoming product exchange items are required';
    end if;
    for v_item in select value from jsonb_array_elements(coalesce(v_data->'incomingItems','[]'::jsonb))
    loop
      v_pid := nullif(v_item->>'pid','')::bigint;
      v_qty := coalesce(nullif(v_item->>'baseQty','')::numeric,
        coalesce(nullif(v_item->>'qty','')::numeric,0) * coalesce(nullif(v_item->>'factor','')::numeric,1));
      v_expiry := nullif(v_item->>'expiry','');
      if v_pid is null or v_qty <= 0 or v_expiry is null then
        raise exception 'invalid incoming product exchange item';
      end if;
      update public.products
      set data = jsonb_set(
            coalesce(data,'{}'::jsonb),
            '{expiry}',
            to_jsonb(case
              when coalesce(stock,0) <= 0 then v_expiry
              when coalesce(data->>'expiry','') = '' then v_expiry
              else least(data->>'expiry',v_expiry)
            end),
            true
          ),
          stock = coalesce(stock,0) + v_qty,
          updated_at = now()
      where id = v_pid;
      if not found then
        raise exception 'incoming product % not found', v_pid;
      end if;
    end loop;
    v_incoming_applied := true;
    v_data := jsonb_set(v_data,'{incomingApplied}','true'::jsonb,true);
    v_data := jsonb_set(v_data,'{incomingAppliedAt}',to_jsonb(now()::text),true);
  end if;

  v_data := jsonb_set(v_data,'{status}',to_jsonb(p_next_status),true);
  v_data := jsonb_set(v_data,'{updatedAt}',to_jsonb(now()::text),true);

  update public.product_exchanges
  set data = v_data,
      updated_at = now()
  where id = p_exchange_id;

  return jsonb_build_object('exchange',v_data);
end;
$$;

revoke execute on function public.apply_product_exchange_status(text,text) from public, anon;
grant execute on function public.apply_product_exchange_status(text,text) to authenticated;

-- Read the confirmed delta once per product line, in the store's business day.
create function private.report_posted_adjustments(p_store bigint, p_from date, p_to date, p_after bigint)
returns table(line_id bigint, document_id uuid, document_no text, warehouse_id bigint,
  movement_date date, movement_time text, product_id bigint, product_name text, unit_name text, difference numeric)
language sql stable security definer set search_path = '' as $$
  select l.id, a.id, a.document_no, a.warehouse_id, (a.created_at at time zone 'Asia/Bangkok')::date,
    to_char(a.created_at at time zone 'Asia/Bangkok','HH24:MI'), l.product_id, p.name, l.unit_name, l.difference
  from public.inventory_count_adjustments a
  join public.inventory_count_adjustment_lines l on l.adjustment_id=a.id
  join public.products p on p.id=l.product_id
  where a.warehouse_id=p_store and a.status='posted' and l.difference<>0 and l.id>p_after
    and a.created_at >= (p_from::timestamp at time zone 'Asia/Bangkok')
    and a.created_at < ((p_to+1)::timestamp at time zone 'Asia/Bangkok')
    and auth.uid() is not null and public.can_current_user_page('inventorymovement',p_store,'view')
    and (private.is_current_owner() or exists(select 1 from public.profile_warehouse_access x
      where x.user_id=auth.uid() and x.warehouse_id=p_store and x.can_sell))
  order by l.id limit 500
$$;
create function public.report_posted_adjustments(p_store bigint,p_from date,p_to date,p_after bigint default 0)
returns table(line_id bigint, document_id uuid, document_no text, warehouse_id bigint,
  movement_date date, movement_time text, product_id bigint, product_name text, unit_name text, difference numeric)
language sql stable security invoker set search_path = '' as $$
  select * from private.report_posted_adjustments(p_store,p_from,p_to,p_after)
$$;

create function private.movement_document_history(p_store bigint,p_entity text,p_document text,p_before timestamptz,p_key text)
returns table(event_key text, occurred_at timestamptz, actor_name text, action text, before_data jsonb, after_data jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_current_owner() then
    raise exception 'owner access required' using errcode='42501';
  end if;
  return query select e.event_key,e.occurred_at,e.actor_name,e.action,e.before_data,e.after_data
    from private.central_audit_events_live e
    where e.warehouse_id=p_store and e.entity_type=p_entity
      and ((p_entity='inventory_count' and e.event_key='stock:'||p_document)
        or (p_entity in ('sales','goods_receipts','product_returns','product_exchanges','transfers') and e.entity_id=p_document))
      and e.occurred_at>=private.audit_log_retention_cutoff()
      and (p_before is null or (e.occurred_at,e.event_key)<(p_before,p_key))
    order by e.occurred_at desc,e.event_key desc limit 25;
end
$$;
create function public.movement_document_history(p_store bigint,p_entity text,p_document text,p_before timestamptz default null,p_key text default null)
returns table(event_key text, occurred_at timestamptz, actor_name text, action text, before_data jsonb, after_data jsonb)
language sql stable security invoker set search_path = '' as $$
  select * from private.movement_document_history(p_store,p_entity,p_document,p_before,p_key)
$$;
revoke all on function private.report_posted_adjustments(bigint,date,date,bigint), public.report_posted_adjustments(bigint,date,date,bigint),
  private.movement_document_history(bigint,text,text,timestamptz,text),public.movement_document_history(bigint,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function private.report_posted_adjustments(bigint,date,date,bigint), public.report_posted_adjustments(bigint,date,date,bigint),
  private.movement_document_history(bigint,text,text,timestamptz,text),public.movement_document_history(bigint,text,text,timestamptz,text) to authenticated;
notify pgrst,'reload schema';

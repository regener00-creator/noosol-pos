-- Shared rich-text notes shown directly below POS in the sidebar.
-- LEVEL 2 visibility is enforced by RLS so hidden note bodies never reach the
-- browser, even when the Data API is called outside the PEPOS interface.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content_html text not null default '',
  hidden_from_level2 boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint notes_title_length check (
    char_length(btrim(title)) between 1 and 160
  ),
  constraint notes_content_length check (
    char_length(content_html) <= 100000
  )
);

alter table public.notes enable row level security;

revoke all on table public.notes from anon, authenticated;
grant select, delete on table public.notes to authenticated;
grant insert (title, content_html, hidden_from_level2) on table public.notes to authenticated;
grant update (title, content_html, hidden_from_level2) on table public.notes to authenticated;
grant all on table public.notes to service_role;

create index if not exists notes_updated_at_idx
  on public.notes(updated_at desc);

create or replace function private.set_note_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := clock_timestamp();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.set_note_audit_fields()
  from public, anon, authenticated;

drop trigger if exists notes_set_audit_fields on public.notes;
create trigger notes_set_audit_fields
before insert or update on public.notes
for each row execute function private.set_note_audit_fields();

drop policy if exists notes_read on public.notes;
create policy notes_read
on public.notes for select
to authenticated
using (
  (select private.is_current_owner())
  or (
    hidden_from_level2 is false
    and (select public.can_current_user_page('notes', null, 'view'))
  )
);

drop policy if exists notes_insert on public.notes;
create policy notes_insert
on public.notes for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (select public.can_current_user_page('notes', null, 'create'))
  and (
    hidden_from_level2 is false
    or (select private.is_current_owner())
  )
);

drop policy if exists notes_update on public.notes;
create policy notes_update
on public.notes for update
to authenticated
using (
  (select private.is_current_owner())
  or (
    created_by = (select auth.uid())
    and hidden_from_level2 is false
    and (select public.can_current_user_page('notes', null, 'edit'))
  )
)
with check (
  (select private.is_current_owner())
  or (
    created_by = (select auth.uid())
    and hidden_from_level2 is false
    and (select public.can_current_user_page('notes', null, 'edit'))
  )
);

drop policy if exists notes_delete on public.notes;
create policy notes_delete
on public.notes for delete
to authenticated
using (
  (select private.is_current_owner())
  or (
    created_by = (select auth.uid())
    and hidden_from_level2 is false
    and (select public.can_current_user_page('notes', null, 'delete'))
  )
);

-- Keep the server-side permission allow-list aligned with the new page.
create or replace function private.replace_staff_page_permissions(
  p_user_id uuid,
  p_warehouse_ids bigint[],
  p_permissions jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_page text;
  v_warehouse_id bigint;
  v_allowed_pages constant text[] := array[
    'dashboard','checkout','notes','cashshift','history','promotions','purchaseorder',
    'goodsreceipt','productexchange','products','stockcontrol','transfer',
    'barcodeprint','contacts','salesreps','cashbill','taxinvoice','quotation',
    'purchaseorder2','productreturn','inventorymovement','rinventory','lowstock',
    'expiry','rproduct','rbill','rprofit','rtax'
  ];
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'array' then
    raise exception 'permissions must be an array';
  end if;

  delete from public.profile_page_permissions where user_id = p_user_id;

  for v_item in select value from jsonb_array_elements(p_permissions)
  loop
    v_page := btrim(coalesce(v_item->>'pageKey', ''));
    v_warehouse_id := nullif(v_item->>'warehouseId', '')::bigint;
    if not (v_page = any(v_allowed_pages)) then
      raise exception 'unsupported page permission: %', v_page;
    end if;
    if v_warehouse_id is not null
       and not (v_warehouse_id = any(p_warehouse_ids)) then
      raise exception 'permission warehouse is not assigned to staff';
    end if;

    insert into public.profile_page_permissions(
      user_id, page_key, warehouse_id,
      can_view, can_create, can_edit, can_delete, can_print, can_export,
      updated_at
    ) values (
      p_user_id, v_page, v_warehouse_id,
      coalesce((v_item->>'canView')::boolean, true),
      coalesce((v_item->>'canCreate')::boolean, false),
      coalesce((v_item->>'canEdit')::boolean, false),
      coalesce((v_item->>'canDelete')::boolean, false),
      coalesce((v_item->>'canPrint')::boolean, false),
      coalesce((v_item->>'canExport')::boolean, false),
      clock_timestamp()
    )
    on conflict (user_id, page_key, warehouse_id) do update
    set can_view = excluded.can_view,
        can_create = excluded.can_create,
        can_edit = excluded.can_edit,
        can_delete = excluded.can_delete,
        can_print = excluded.can_print,
        can_export = excluded.can_export,
        updated_at = clock_timestamp();
  end loop;
end;
$$;

revoke all on function private.replace_staff_page_permissions(uuid, bigint[], jsonb)
  from public, anon, authenticated, service_role;

-- Existing LEVEL 2 accounts receive the NOTE page immediately. RLS still
-- limits them to public notes and lets them modify only notes they created.
insert into public.profile_page_permissions(
  user_id, page_key, warehouse_id,
  can_view, can_create, can_edit, can_delete, can_print, can_export
)
select profile.id, 'notes', null, true, true, true, true, false, false
from public.profiles profile
where profile.owner is false and profile.level = 2
on conflict (user_id, page_key, warehouse_id) do nothing;

comment on table public.notes
is 'Shared rich-text notes. Rows marked hidden_from_level2 are filtered by RLS.';

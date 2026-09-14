-- Customer phone numbers are member identifiers in the POS. Formatting marks
-- such as dashes must not allow the same number to be registered twice.
create unique index if not exists contacts_customer_phone_unique
on public.contacts ((regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')))
where type in ('customer', 'both')
  and nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '') is not null;

comment on index public.contacts_customer_phone_unique is
  'Prevents duplicate non-empty customer phone numbers after removing formatting characters.';

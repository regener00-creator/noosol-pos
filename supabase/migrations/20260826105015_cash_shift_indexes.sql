-- Covers the closing actor foreign key and owner history lookup.
create index if not exists idx_cash_shifts_closed_by
on public.cash_shifts(closed_by) where closed_by is not null;

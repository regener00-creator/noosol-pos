-- The hardening migration briefly added a second index with the same key as
-- idx_cash_shifts_closed_by from 0043_cash_shift_indexes.sql. Keep the
-- established index and remove only the duplicate to avoid write/storage cost.

drop index if exists public.idx_cash_shifts_closed_by_fk;

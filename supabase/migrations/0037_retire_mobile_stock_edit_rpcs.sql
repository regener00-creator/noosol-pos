-- Retire the former mobile price-check RPCs that also accepted stock.
-- Old cached clients must fail safely instead of changing inventory quantities.

revoke execute on function public.owner_update_mobile_product(bigint,bigint,jsonb,numeric,numeric,numeric,date)
from public,anon,authenticated;

revoke execute on function public.owner_update_mobile_product_lot(bigint,bigint,bigint,jsonb,numeric,numeric,numeric,date)
from public,anon,authenticated;

-- favorites_pkey now indexes product_id, so the former secondary index would
-- duplicate the same btree and waste storage/write work.
drop index if exists public.idx_favorites_product_id;

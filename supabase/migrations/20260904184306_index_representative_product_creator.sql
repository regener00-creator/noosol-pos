-- Cover the auth.users foreign key so deleting a user does not require a full
-- scan of representative-product assignments.
create index sales_representative_products_created_by_idx
  on public.sales_representative_products(created_by)
  where created_by is not null;

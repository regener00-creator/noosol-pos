-- Claims cover the primary, additional-unit, alternate and supplier barcode fields.
alter table private.product_barcode_claims add constraint product_barcode_shop_prefix
  check (barcode !~ '^([ab]|w[0-9]+-)p[0-9]{11}$'
         or starts_with(barcode, lower(private.shop_letter(warehouse_id)) || 'p'));

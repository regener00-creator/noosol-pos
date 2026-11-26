-- Use the catalog unit cost that checkout has already resolved.
do $migration$
declare
  definition text:=pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure);
  anchor text:=$anchor$v_expected_price:=private.resolve_volume_or_group_price(p_warehouse_id,v_sale_data,p_items,v_item,v_product,v_unit_name,v_expected_price);$anchor$;
begin
  if strpos(definition,anchor)=0 then raise exception 'unknown quantity price checkout guard'; end if;
  execute replace(definition,anchor,anchor||$patch$
        if v_item->>'priceSource'='tier' and v_expected_price<v_expected_cost then
          raise exception 'ราคาขั้นบันไดต่ำกว่าทุน กรุณาโหลดข้อมูลล่าสุดแล้วตรวจรายการขายอีกครั้ง';
        end if;$patch$);
end $migration$;

notify pgrst,'reload schema';

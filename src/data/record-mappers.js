const PRODUCT_DUPLICATE_DATA_KEYS=['id','sku','name','category','brand','type','product_type','wh','warehouse_id','stock','cost','price','unit','expiry','_catalogExpiry','_revision','scanDefaultUnit'];
function additionalData(record,duplicateKeys){
  const data={...(record&&typeof record==='object'?record:{})};
  duplicateKeys.forEach(key=>delete data[key]);
  return data;
}
function productToRow(p){
  const data=additionalData(p,PRODUCT_DUPLICATE_DATA_KEYS);
  return { id:p.id, sku:p.sku||null, name:p.name||'', category:p.category||null, brand:p.brand||null, product_type:p.type||null, warehouse_id:p.wh||null, cost:Number(p.cost)||0, price:Number(p.price)||0, unit:p.unit||null, data };
}
// Existing product metadata must never carry a possibly stale stock value from
// another browser tab. Stock is changed only through the atomic stock RPCs.
function productMetadataToRow(p){
  const data=additionalData(p,PRODUCT_DUPLICATE_DATA_KEYS);
  return { id:p.id, sku:p.sku||null, name:p.name||'', category:p.category||null, brand:p.brand||null, product_type:p.type||null, warehouse_id:p.wh||null, cost:Number(p.cost)||0, price:Number(p.price)||0, unit:p.unit||null, data, revision:Number(p._revision)||0 };
}
function rowToProduct(row){
  row=row||{};
  const data={...(row.data&&typeof row.data==='object'?row.data:{})};
  delete data.scanDefaultUnit;
  const hasValue=value=>value!==null&&value!==undefined&&value!=='';
  const textValue=(key,flatValue,fallback='')=>Object.hasOwn(data,key)&&hasValue(data[key])?data[key]:(hasValue(flatValue)?flatValue:fallback);
  const numberValue=(key,flatValue)=>{
    if(Object.hasOwn(data,key)&&hasValue(data[key])&&Number.isFinite(Number(data[key]))) return Number(data[key]);
    return Number.isFinite(Number(flatValue))?Number(flatValue):0;
  };
  // The data fallback is read-only compatibility for a device that opens an
  // old row before the cleanup migration. New writes always remove these keys.
  return {
    ...data,
    id:row.id,
    sku:textValue('sku',row.sku),
    name:textValue('name',row.name),
    category:textValue('category',row.category),
    brand:textValue('brand',row.brand),
    type:textValue('type',row.product_type,'stock'),
    wh:Object.hasOwn(data,'wh')&&hasValue(data.wh)?data.wh:(row.warehouse_id??null),
    stock:0,
    cost:numberValue('cost',row.cost),
    price:numberValue('price',row.price),
    unit:textValue('unit',row.unit),
    _revision:Number(row.revision)||1,
    _catalogExpiry:textValue('expiry',null),
  };
}
function warehouseToRow(w){ return { id:w.id, name:w.name||'', data:additionalData(w,['id','name']) }; }
function rowToWarehouse(row){ return { ...(row.data||{}), id:row.id, name:row.name }; }
function contactToRow(c){
  const types=Array.isArray(c.types)?c.types:[];
  const type=types.includes('customer')&&types.includes('supplier')?'both':(types.includes('supplier')?'supplier':'customer');
  return { id:c.id, type, name:c.name||'', phone:c.phone||null, data:additionalData(c,['id','type','types','name','phone','_revision']), revision:Number(c._revision)||0 };
}
function rowToContact(row){
  const types=row.type==='both'?['customer','supplier']:[row.type==='supplier'?'supplier':'customer'];
  return { ...(row.data||{}), id:row.id, name:row.name, phone:row.phone||'', types, ...(types.includes('customer')?{loyaltyJoinedAt:row.data?.loyaltyJoinedAt||row.created_at||''}:{}), _revision:Number(row.revision)||1 };
}
function salesRepToRow(r){ return { id:r.id, name:r.name||'', data:additionalData(r,['id','name','_revision']), revision:Number(r._revision)||0 }; }
function rowToSalesRep(row){ return { ...(row.data||{}), id:row.id, name:row.name, _revision:Number(row.revision)||1 }; }

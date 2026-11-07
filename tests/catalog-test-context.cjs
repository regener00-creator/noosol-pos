// Partial-script unit tests need the same catalog partition and business resolver as the full app.
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
const catalog=source('state/catalog.js');
const business=source('state/sales-and-documents.js');
const storeDocument=source('documents/helpers.js').match(/^function documentInActiveStore\([^\n]*\)\{[\s\S]*?^\}/m)[0];
const helpers=storeDocument+'\n'+catalog.slice(catalog.indexOf('function completeProductCatalog('),catalog.indexOf('let productByIdMap='))+
  business.slice(business.indexOf('function warehouseBusinessSettings('),business.indexOf('function isBusinessVatRegistered('));
function createContext(sandbox={}){
  const ctx=vm.createContext(sandbox);
  Object.assign(ctx,{otherWarehouseProducts:[],warehouseBusinessProfiles:{},activeWarehouseId:0,
    isAllWarehousesMode:()=>false,accessibleWarehouses:()=>[],rebuildProductLookupMaps:()=>{},...sandbox});
  vm.runInContext(helpers,ctx);
  return ctx;
}
module.exports={...vm,createContext,runInNewContext:(source,sandbox,options)=>vm.runInContext(source,createContext(sandbox),options)};

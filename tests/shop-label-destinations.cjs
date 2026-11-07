const assert=require('node:assert/strict');

module.exports=async function verifyShopLabelDestinations(page){
  await page.setViewportSize({width:1280,height:850});
  await page.evaluate(async()=>{
    for(const tab of ['productexchange','quotation','taxinvoice','barcodeprint','productreturn','promotions','stockcontrol']) await ensurePageCodeLoaded(tab);
    isBusinessVatRegistered=()=>true;
    const rows=completeProductCatalog();
    for(const [id,prefix,foreign] of [[11,'AP','BP'],[12,'BP','AP']]){
      const p=rows.find(row=>row.id===id);
      p.barcode=prefix+'00000000002';
      p.units[0].barcode=prefix+'00000000001';
      p.extraBarcodes=[foreign+'00000000001','P00000000001'];
      p.extraBarcodeUnits=['กล่อง','กล่อง'];
    }
    setWarehouseProductCatalog(rows);
    const rpc=sb.rpc.bind(sb);
    sb.rpc=(name,args)=>name==='system_issued_label_codes'
      ?Promise.resolve({data:products.flatMap(p=>barcodePrintUnitOptions(p).filter(unit=>systemLabelCode(unit.barcode,activeWarehouseId)).map(unit=>({pid:p.id,barcode:unit.barcode}))),error:null})
      :rpc(name,args);
  });
  for(const [store,id,prefix,other] of [[1,11,'AP','BP'],[2,12,'BP','AP']]){
    await page.evaluate(store=>selectActiveWarehouse(store),store);
    for(const [tab,field,result] of [
      ['row','.poi_name','.return-row-results button'],
      ['quotation','#docProductScanner','.doc-scan-result'],
      ['taxinvoice','#docProductScanner','.doc-scan-result'],
      ['outgoing','#productExchangeScan_outgoing','[data-product-exchange-result^="outgoing:"]'],
      ['incoming','#productExchangeScan_incoming','[data-product-exchange-result^="incoming:"]'],
      ['reprint','#barcodePrintSearch','[data-barcode-print-result]'],
      ['newLabel','#barcodePrintSearch','[data-barcode-print-result]']
    ]){
      for(const [part,tap] of [[other,false],['P',false],[prefix,false],[prefix,true]]){
        await page.evaluate(async tab=>{
          if(tab==='quotation'){openNewQuotationForm();return;}
          if(tab==='taxinvoice'){openNewTaxInvoiceForm();return;}
          if(tab==='row'){
            currentTab='productreturn';editingReturnId='new';returnDraft=null;render();
            document.getElementById('addPOItemBtn').click();
            return;
          }
          if(tab==='reprint'||tab==='newLabel'){
            currentTab='barcodeprint';barcodePrintItems=[];barcodePrintOtherQueue=null;barcodePrintMode='new';
            if(tab==='reprint') await setBarcodePrintMode('reprint');
            else setBarcodePrintMode('new');
            return;
          }
          currentTab='productexchange';editingProductExchangeId='new';productExchangeDraft=null;render();
        },tab);
        const input=page.locator(field).last(),choices=page.locator(result);
        await input.fill(part+'00000000001');
        assert.equal(await choices.count(),part===prefix?1:0,`${store} ${tab} candidates for ${part}`);
        if(tap) await choices.click();else await input.press('Enter');
        if(part===prefix&&tab==='newLabel')await page.waitForFunction(()=>barcodePrintItems.length===1);
        const selected=await page.evaluate(tab=>{
          if(tab==='row'){
            syncPOFromDOM();
            return returnDraft.items.map(item=>[item.productId,item.unit]);
          }
          if(tab==='newLabel'||tab==='reprint')return barcodePrintItems.map(i=>[i.pid,i.unit,i.barcode]);
          if(tab==='quotation'||tab==='taxinvoice')return taxInvoiceDraft.items.filter(i=>i.name).map(i=>[i.productId||i.pid,i.unit]);
          return productExchangeDraft[tab+'Items'].map(i=>[i.pid,i.unit]);
        },tab);
        const expected=part===prefix?[[id,'กล่อง']]:[];
        if(expected.length&&(tab==='reprint'||tab==='newLabel'))expected[0].push(prefix+'00000000001');
        if(tab==='row'){
          assert.equal(selected[0][0],'','the scanner edits only the target row');
          assert.deepEqual(selected.slice(1),expected.length?expected:[['','']]);
        }else assert.deepEqual(selected,expected,`${store} ${tab} ${part} tap=${tap}`);
      }
    }
    await page.evaluate(async({id,store})=>{
      currentTab='stockcontrol';stockControlMode='lots';stockLotReallocationSearch='';
      inventoryLotRows=[1,2].map(n=>({id:100+n,warehouse_id:store,product_id:id,quantity_base:10,manufacturer_lot:'LOT'+n,status:'active'}));
      rebuildInventoryLotMap();
      const original=sb.from.bind(sb);
      sb.from=table=>{
        if(table!=='inventory_lots'&&table!=='inventory_balances') return original(table);
        const chain=new Proxy({}, {get(_target,key){
          if(key==='then')return resolve=>resolve({data:table==='inventory_lots'?inventoryLotRows:{stock:20},error:null});
          return ()=>chain;
        }});
        return chain;
      };
      render();
    },{id,store});
    const lotInput=page.locator('#stockLotReallocationSearch');
    for(const [part,tap] of [[other,false],['P',false],[prefix,false],[prefix,true]]){
      await lotInput.fill(part+'00000000001');
      const buttons=page.locator('[data-stock-lot-reallocation]');
      assert.equal(await buttons.count(),part===prefix?1:0);
      if(tap)await buttons.click();else await lotInput.press('Enter');
      if(part===prefix){
        assert.equal(await page.locator('#stockLotReallocationUnit').inputValue(),'กล่อง');
        assert.equal(await page.locator('#confirmStockLotReallocation').isDisabled(),true);
        await page.locator('#cancelStockLotReallocation').click();
      }
    }
  }
};

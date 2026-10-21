const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('./load-app-source')();
const code=source.slice(source.indexOf('const RECEIPT_PRINTER_STORAGE_KEY='),source.indexOf('function receiptPrinterLayoutCss('));
const entries=new Map();
let address='https://pepo-pharmacy.vercel.app/?sapuriPaper=58&sapuriSetup='+ 'a'.repeat(32)+'&keep=1';
const context={URL,console,localStorage:{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value)},window:{location:{get href(){return address;}},history:{state:{},replaceState(state,title,url){address=url;}}}};
vm.createContext(context);vm.runInContext(code,context);
context.applyReceiptPrinterSetupLink();
assert.equal(context.readReceiptPrinterSettings().paperWidth,58);
assert.equal(address,'https://pepo-pharmacy.vercel.app/?keep=1');
entries.set('pepos_receipt_printer_v1',JSON.stringify({paperWidth:80,marginLeft:3}));
address='https://pepo-pharmacy.vercel.app/?sapuriPaper=58&sapuriSetup='+ 'a'.repeat(32);
context.applyReceiptPrinterSetupLink();
assert.equal(context.readReceiptPrinterSettings().paperWidth,80,'opening the same shortcut preserves later user changes');
address='https://pepo-pharmacy.vercel.app/?sapuriPaper=58&sapuriSetup='+ 'b'.repeat(32);
context.applyReceiptPrinterSetupLink();
assert.equal(context.readReceiptPrinterSettings().paperWidth,58,'a new setup applies changed paper width');
assert.equal(context.readReceiptPrinterSettings().marginLeft,3,'preserve existing margins');
for(const query of ['sapuriPaper=999&sapuriSetup='+ 'c'.repeat(32),'sapuriPaper=80&sapuriSetup=bad','sapuriPaper=80']){
 address='https://pepo-pharmacy.vercel.app/?'+query;context.applyReceiptPrinterSetupLink();assert.equal(context.readReceiptPrinterSettings().paperWidth,58);
}
assert.ok(source.indexOf('applyReceiptPrinterSetupLink();')>source.indexOf('function applyReceiptPrinterSetupLink()'),'preset applies after settings declarations');
console.log('receipt printer setup link tests passed');

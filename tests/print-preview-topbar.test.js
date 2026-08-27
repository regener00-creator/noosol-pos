const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

if(!source.includes('function standardizePrintPreview(win)')) throw new Error('missing shared print preview topbar');
if(!source.includes("backButton.textContent='ย้อนกลับ'")) throw new Error('missing back button');
if(!source.includes("newPrintButton.textContent='พิมพ์'")) throw new Error('missing print button');
if(source.includes('class="preview-doc-number"')) throw new Error('document number still appears on the print topbar');
if(!source.includes('id="closeDocumentPreview">ย้อนกลับ</button>')) throw new Error('A4 document preview does not use the back label');
if(!source.includes('id="closeTaxPreview">ย้อนกลับ</button>')) throw new Error('tax invoice preview does not use the back label');

const standardizeCalls=(source.match(/standardizePrintPreview\((?:win|printWindow)\)/g)||[]).length;
if(standardizeCalls<13) throw new Error(`not every print preview is standardized (${standardizeCalls}/13)`);

console.log('print preview topbar tests passed');

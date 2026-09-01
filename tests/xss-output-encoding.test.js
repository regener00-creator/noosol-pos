const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();
const textPayload = '<img src=x onerror="globalThis.__xss=1">';
const attributePayload = '"><img src=x onerror="globalThis.__xss=1">';
const textareaPayload = '</textarea><img src=x onerror="globalThis.__xss=1">';
const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return html.slice(start, end);
}

function assertPayloadEncoded(output, label) {
  assert.doesNotMatch(output, /<img\b/i, `${label} must not emit a live img element`);
  assert.doesNotMatch(output, /<script\b/i, `${label} must not emit a live script element`);
  assert.doesNotMatch(output, /<\/textarea>\s*<img\b/i, `${label} must not break out of textarea`);
  assert.match(output, /&lt;(?:img|\/textarea)/i, `${label} should contain encoded payload text`);
}

test('document previews and representative contact details encode stored values', () => {
  const context = {
    escapeHtml,
    salesRepresentatives: [{name: 'unsafe rep', phone: attributePayload, line: textPayload}],
  };
  vm.createContext(context);
  const source = sourceBetween('function documentItemsPreview(', 'function shortageAllItems(');
  vm.runInContext(`${source}\nthis.documentItemsPreview=documentItemsPreview;this.shortageRepresentativeContact=shortageRepresentativeContact;`, context);

  assertPayloadEncoded(context.documentItemsPreview([{name: textPayload, qty: attributePayload}]), 'documentItemsPreview');
  assertPayloadEncoded(context.shortageRepresentativeContact('unsafe rep'), 'shortageRepresentativeContact');
});

test('product form option and barcode helpers encode text and quoted attributes', () => {
  const context = {
    escapeHtml,
    suppliersList: () => [{name: attributePayload}],
    units: [attributePayload],
    isLevel2User: () => false,
  };
  vm.createContext(context);
  const source = sourceBetween('function vendorBarcodeRowHtml(', 'function collectUnitRowsFromDOM(');
  vm.runInContext(`${source}\nthis.vendorBarcodeRowHtml=vendorBarcodeRowHtml;this.comboSelect=comboSelect;this.unitRowHtml=unitRowHtml;`, context);

  assertPayloadEncoded(context.vendorBarcodeRowHtml({vendor: attributePayload, code: attributePayload}), 'vendorBarcodeRowHtml');
  assertPayloadEncoded(context.comboSelect('field', [attributePayload], attributePayload, textPayload), 'comboSelect');
  assertPayloadEncoded(context.unitRowHtml({sub: attributePayload, per: 1, base: attributePayload, price: 1, cost: 1, stock: 1, barcode: attributePayload}, attributePayload, []), 'unitRowHtml');
});

test('product and sales-representative edit forms encode input and textarea values', () => {
  const productContext = {
    escapeHtml,
    editingProductId: 7,
    products: [{
      id: 7,
      sku: attributePayload,
      name: textPayload,
      desc: textareaPayload,
      category: 'ยา',
      brand: 'ทั่วไป',
      unit: 'ชิ้น',
      barcode: attributePayload,
      price: 1,
      cost: 1,
      stock: 1,
      vat: 'none',
      active: true,
      multiunit: false,
      units: [],
      extraBarcodes: [],
      vendorBarcodes: [],
    }],
    units: ['ชิ้น'],
    categories: ['ยา'],
    brands: ['ทั่วไป'],
    isLevel2User: () => false,
    comboSelect: (id, list, selected, placeholder) => `<select id="${escapeHtml(id)}"><option value="${escapeHtml(selected)}">${escapeHtml(placeholder)}</option></select>`,
    isProductActive: () => true,
    isBusinessVatRegistered: () => false,
    normalizeProductVatMode: () => 'none',
    computeUnitRowsWithStock: rows => rows,
    unitRowHtml: () => '',
    extraBarcodeEntries: () => [],
    extraBarcodeAvailableUnits: () => [],
    extraBarcodeRowHtml: () => '',
    vendorBarcodeRowHtml: () => '',
    loggedInUser: () => ({owner: true, level: 1}),
  };
  vm.createContext(productContext);
  const productSource = sourceBetween('function renderProductForm(', 'function renderWarehouse(');
  vm.runInContext(`${productSource}\nthis.renderProductForm=renderProductForm;`, productContext);
  assertPayloadEncoded(productContext.renderProductForm(), 'renderProductForm');

  const repContext = {
    escapeHtml,
    editingSalesRepresentativeId: 9,
    salesRepresentatives: [{id: 9, code: attributePayload, name: textPayload, phone: attributePayload, line: attributePayload, company: textPayload, note: textareaPayload}],
  };
  vm.createContext(repContext);
  const repSource = sourceBetween('function renderSalesRepresentativeForm(', '// ===== ระบบโปรโมชั่น =====');
  vm.runInContext(`${repSource}\nthis.renderSalesRepresentativeForm=renderSalesRepresentativeForm;`, repContext);
  assertPayloadEncoded(repContext.renderSalesRepresentativeForm(), 'renderSalesRepresentativeForm');
});

test('supplier editor and purchase item rows encode stored values', () => {
  const supplierContext = {escapeHtml};
  vm.createContext(supplierContext);
  const supplierSource = sourceBetween('function poSupplierEditorHtml(', 'function renderPurchaseOrder2(');
  vm.runInContext(`${supplierSource}\nthis.poSupplierEditorHtml=poSupplierEditorHtml;`, supplierContext);
  assertPayloadEncoded(supplierContext.poSupplierEditorHtml({
    name: attributePayload,
    taxId: attributePayload,
    contactName: attributePayload,
    phone: attributePayload,
    email: attributePayload,
    creditDays: 1,
    address: textareaPayload,
  }), 'poSupplierEditorHtml');

  const rowContext = {
    escapeHtml,
    products: [{id: 1, name: textPayload, unit: attributePayload, cost: 1, units: []}],
    poPurchaseUnitOptions: product => [{name: product.unit, cost: 1, factor: 1}],
    currentTab: 'purchaseorder2',
    activePurchaseDraft: () => ({stockApplied: false}),
    fmtMoney: value => String(Number(value) || 0),
  };
  vm.createContext(rowContext);
  const rowSource = sourceBetween('function shortageItemRowHtml(', 'function productReturnItemRowHtml(');
  vm.runInContext(`${rowSource}\nthis.shortageItemRowHtml=shortageItemRowHtml;this.poItemRowHtml=poItemRowHtml;`, rowContext);
  assertPayloadEncoded(rowContext.shortageItemRowHtml({name: textPayload, qty: 1, unit: attributePayload}, 0), 'shortageItemRowHtml');
  assertPayloadEncoded(rowContext.poItemRowHtml({productId: 1, name: textPayload, qty: 1, unit: attributePayload, price: 1}, 0), 'poItemRowHtml');
});

test('printPO encodes document, supplier, and item fields before document.write', () => {
  let written = '';
  const supplier = {name: textPayload, address: textPayload, taxId: textPayload, phone: textPayload, line: textPayload, note: textPayload};
  const document = {
    id: '</title><script>globalThis.__xss=1</script>',
    supplier: textPayload,
    date: '2026-09-01',
    dueDate: '2026-09-02',
    items: [{name: textPayload, qty: 1, unit: attributePayload, price: 10}],
    note: textareaPayload,
    discount: 0,
    taxMode: 'none',
    businessSnapshot: {name: 'Safe', address: 'Safe', taxId: '', website: ''},
  };
  const context = {
    escapeHtml,
    isSupplierStyleDoc: () => true,
    docLabelText: () => 'ใบสั่งซื้อสินค้า',
    docList: () => [document],
    calculatePurchaseTaxSummary: () => ({subtotal: 10, total: 10, vat: 0, beforeVat: 10, registered: false}),
    businessSettings: document.businessSnapshot,
    suppliersList: () => [supplier],
    salesRepresentatives: [],
    businessDocumentName: () => 'Safe',
    STORE_INFO: {name: 'Safe', address: 'Safe', taxId: '', website: ''},
    businessPrimaryPhone: () => '',
    fmtDateShort: value => String(value || ''),
    documentDueDate: doc => doc.dueDate,
    loggedInUser: () => ({firstName: 'Owner'}),
    employees: ['Owner'],
    fmtMoney: value => String(Number(value) || 0),
    bahtText: () => 'สิบบาทถ้วน',
    window: {open: () => ({document: {write: value => { written = value; }, close: () => {}}})},
    standardizePrintPreview: () => {},
    setupA4DocumentPreview: () => {},
  };
  vm.createContext(context);
  const printSource = sourceBetween('function printPO(', '// แปลงตัวเลขเป็นข้อความภาษาไทย');
  vm.runInContext(`${printSource}\nthis.printPO=printPO;`, context);
  context.printPO(document.id, 'po2');
  assertPayloadEncoded(written, 'printPO');
});

test('critical render and payment paths retain output encoding and atomic RPC guards', () => {
  const productsSource = sourceBetween('function renderProducts(', 'function comboSelectorFor(');
  assert.match(productsSource, /value="\$\{escapeHtml\(searchQuery\)\}"/);
  assert.match(productsSource, /\$\{escapeHtml\(stockInLargestUnit\(p\)\)\}/);
  assert.doesNotMatch(productsSource, /col-expiry|หมดอายุใกล้สุด/);

  const manageSource = sourceBetween('function openManageModal(', 'function extraBarcodeEntries(');
  assert.match(manageSource, /data-name="\$\{escapeHtml\(x\)\}"/);
  assert.match(manageSource, /<span>\$\{escapeHtml\(x\)\}<\/span>/);

  const paymentSource = sourceBetween('function openGoodsReceiptPayment(', 'function activePurchaseDraft(');
  assert.match(paymentSource, /\$\{escapeHtml\(doc\.id\)\} \(\$\{escapeHtml\(doc\.supplier\)\}\)/);
  assert.match(paymentSource, /await sb\.rpc\('record_goods_receipt_payment',\{p_receipt_id:doc\.id,p_payment:payment\}\)/);
  assert.match(paymentSource, /Object\.assign\(doc,data\.receipt\)/);
  assert.match(paymentSource, /seedTableSnapshot\('goods_receipts',goodsReceipts,docToRow\)/);
  assert.match(paymentSource, /savePaymentBtn\.disabled=true/);
  assert.match(paymentSource, /showToast\([^;]+,'danger-top'\)/s);
});

test('report search results, dashboard summaries, and system-user action attributes encode stored values', () => {
  const dashboardSource = sourceBetween('function renderDashboard(', 'function matchesBarcode(');
  assert.match(dashboardSource, /<span class="lname">\$\{escapeHtml\(name\)\}<\/span>/);
  assert.match(dashboardSource, /\$\{escapeHtml\(s\.ref\|\|s\.id\)\}/);
  assert.match(dashboardSource, /\$\{escapeHtml\(s\.payMethod\|\|'-'\)\}/);

  const bindingSource = sourceBetween('const renderSrResults=', '// --- หน้าพิมพ์ป้ายราคา');
  assert.match(bindingSource, /<b>\$\{escapeHtml\(p\.name\)\}<\/b>/);
  const productReportBindingSource = sourceBetween('// ===== ตัวกรองรายงานยอดขายตามสินค้า =====', '// ===== ตัวกรองรายงานยอดขายตามบิล =====');
  assert.match(productReportBindingSource, /data-name="\$\{escapeHtml\(p\.name\)\}"/);
  assert.match(productReportBindingSource, /\$\{escapeHtml\(p\.barcode\|\|'ไม่มีบาร์โค้ด'\)\}/);

  const systemUserSource = sourceBetween('function renderSystemUsers(', 'function systemUserLevelLabel(');
  assert.match(systemUserSource, /data-edit-system-user="\$\{escapeHtml\(u\.id\)\}"/);
  assert.match(systemUserSource, /data-delete-system-user="\$\{escapeHtml\(u\.id\)\}"/);
});

test('transfer print window encodes document and item fields before document.write', () => {
  let written = '';
  const transfer = {
    id: '</title><script>globalThis.__xss=1</script>',
    date: textPayload,
    transferor: textPayload,
    from: textPayload,
    to: textPayload,
    totalQty: textPayload,
    note: textareaPayload,
    items: [{name: textPayload, qty: attributePayload, unit: textPayload, cost: 1}],
  };
  const context = {
    escapeHtml,
    transfers: [transfer],
    fmtMoney: value => String(Number(value) || 0),
    fmtDate: value => String(value || ''),
    window: {open: () => ({document: {write: value => { written = value; }, close: () => {}}})},
    showToast: () => {},
    standardizePrintPreview: () => {},
  };
  vm.createContext(context);
  const source = sourceBetween('function printTransfer(', 'function bindUnitRowEvents(');
  vm.runInContext(`${source}\nthis.printTransfer=printTransfer;`, context);
  context.printTransfer(transfer.id);
  assertPayloadEncoded(written, 'printTransfer');
});

test('date and audit formatters never echo arbitrary stored markup', () => {
  const context = {};
  vm.createContext(context);
  const dateSource = sourceBetween('function fmtDateShort(', 'function fmtDashboardDate(');
  const auditSource = sourceBetween('function auditDisplay(', 'function shortReceiptNumber(');
  vm.runInContext(`${dateSource}\n${auditSource}\nthis.fmtDateShort=fmtDateShort;this.auditDisplay=auditDisplay;`, context);

  assert.equal(context.fmtDateShort('2026-09-01'), '01-09-2026');
  assert.equal(context.fmtDateShort(textPayload), '-');
  assert.equal(context.auditDisplay(textPayload), '-');

  const receiptSource = sourceBetween('function openHistoricalReceiptActions(', 'function openFullTaxInvoiceModal(');
  assert.match(receiptSource, /escapeHtml\(shortReceiptNumber\(sale\)\)/);
});

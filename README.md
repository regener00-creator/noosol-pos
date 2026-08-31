# NOOSOL POS

ระบบ POS ร้านยาแบบไฟล์เดียว โดยข้อมูลทำงานร่วมกับ Supabase และมี `localStorage` เป็นข้อมูลฝั่งอุปกรณ์
กำลัง migrate ไปใช้ **Supabase** เป็นฐานข้อมูลกลาง เพื่อให้เข้าถึงข้อมูลได้จากหลายเครื่อง/หลายผู้ใช้พร้อมกัน
และ deploy ผ่าน **Vercel** ที่ https://pepo-pharmacy.vercel.app
(`pepos.vercel.app` ถูกจองไปแล้วโดยบัญชีอื่นในระบบ Vercel เลยใช้ `pepo-pharmacy.vercel.app` แทน)

## สถานะปัจจุบัน

- [x] สร้าง GitHub repo (private): `regener00-creator/noosol-pos`
- [x] Deploy ขึ้น Vercel — ใช้งานได้จริงที่ https://pepo-pharmacy.vercel.app (ยังเป็นแอปเดิม localStorage)
- [x] สร้าง Supabase project ใหม่ `noosol-pos` (แยกจาก project เว็บไซต์เดิม, Region Singapore)
- [x] รัน schema ครบ 21 ตาราง + เปิด RLS ทุกตาราง (`supabase/migrations/0001_init.sql`)
- [x] เพิ่ม `supabase-config.js` (URL + publishable key สำหรับฝั่ง frontend)
- [ ] ตั้งค่า Supabase Auth แทนระบบล็อกอิน password-plaintext เดิม (`systemUsers`)
- [ ] แก้โค้ดแอปให้เรียก Supabase แทน localStorage ทีละโมดูล (ดูลำดับที่แนะนำด้านล่าง)
- [ ] Seed ข้อมูล master data เดิม (categories/units/brands/products ตัวอย่าง) เข้าตารางจริง

**Supabase project:** `noosol-pos` (org: JOAH) — ref `tgwqmpvdjyxwivjxceoq`, URL `https://tgwqmpvdjyxwivjxceoq.supabase.co`

## โครงสร้างข้อมูล (จากการอ่านโค้ดต้นฉบับ)

แอปเดิมเก็บ state ในตัวแปร JS แล้วบันทึกลง `localStorage` 2 แบบ:
1. **แยกคีย์เฉพาะโมดูล** (มี `persistXxx()` ของตัวเอง) — warehouses, contacts, salesHistory, quotations, transfers, standaloneTaxInvoices, lowStockSettings
2. **รวมเป็นก้อนเดียว** ผ่าน `workspaceSnapshot()` (debounce 80ms) — ครอบคลุมทุกอย่างที่เหลือ

รายการโมดูล/ตารางที่ต้องแปลงเป็น Supabase (ประมาณ 20 โมดูล):

| # | ตัวแปรเดิม | ความหมาย | ตารางที่วางแผน |
|---|---|---|---|
| 1 | `warehouses` | คลังสินค้า | `warehouses` |
| 2 | `products` | สินค้า | `products` |
| 3 | `contacts` | ลูกค้า/ผู้จำหน่าย | `contacts` |
| 4 | `salesRepresentatives` | ผู้แทนขาย | `sales_representatives` |
| 5 | `salesHistory` | ประวัติการขาย/ใบเสร็จ | `sales`, `sale_items` |
| 6 | `quotations` | ใบเสนอราคา | `quotations` |
| 7 | `invoicesAR` | ใบกำกับภาษี/ลูกหนี้ | `invoices_ar` |
| 8 | `creditNotes` | ใบลดหนี้ | `credit_notes` |
| 9 | `purchaseOrders` | ใบสั่งซื้อ (แบบเดิม) | `purchase_orders` |
| 10 | `goodsReceipts` | ใบรับสินค้า | `goods_receipts` |
| 11 | `purchaseOrdersFull` | ใบสั่งซื้อสินค้า (เต็มรูปแบบ) | `purchase_orders_full` |
| 12 | `productReturns` | ใบคืนสินค้า | `product_returns` |
| 13 | `transfers` | โอนสินค้าระหว่างคลัง | `transfers` |
| 14 | `standaloneTaxInvoices` | ใบกำกับภาษีที่สร้างเอง | `standalone_tax_invoices` |
| 15 | `favorites` | สินค้าโปรด | `favorites` (per user) |
| 16 | `systemUsers` | ผู้ใช้งาน + auth | ใช้ **Supabase Auth** แทนรหัสผ่านที่เก็บเป็น plain text เดิม |
| 17 | `currentUserProfile` | โปรไฟล์เจ้าของ | `profiles` |
| 18 | `documentPrefixes` | คำนำหน้าเลขที่เอกสาร | `settings` |
| 19 | `lowStockSettings` | เกณฑ์แจ้งเตือนสินค้าใกล้หมด | `settings` |
| 20 | `businessSettings` | ข้อมูลร้าน/ใบกำกับภาษี | `settings` |
| - | `categories`,`units`,`brands`,`productTypes`,`employees` | master data แบบ static | `categories`,`units`,`brands` |

**หมายเหตุความปลอดภัย:** ระบบเดิมเก็บรหัสผ่านผู้ใช้เป็น plain text ในตัวแปร JS (`systemUsers[].password`)
ตอนย้ายไป Supabase จะเปลี่ยนไปใช้ Supabase Auth (เข้ารหัสจริง) แทน — ล็อกอินหน้าตาจะเหมือนเดิม แต่ปลอดภัยขึ้นมาก

## แผนการทำงาน (ทำทีละส่วน)

**Milestone 0 (เสร็จแล้ว):** deploy แอปเดิมขึ้น Vercel ตรงๆ (ยังใช้ localStorage) → https://pepo-pharmacy.vercel.app
**Milestone 1 (เสร็จแล้ว):** สร้าง Supabase project + schema ครบ 21 ตาราง + RLS
**Milestone 2 (ถัดไป):** ตั้งค่า Supabase Auth (สร้างบัญชีเจ้าของ/พนักงานจริงแทน systemUsers เดิม)
**Milestone 3+:** ย้ายทีละโมดูลตามลำดับความสำคัญ:
  1. master data (categories/units/brands) + products + warehouses
  2. contacts (ลูกค้า/ผู้จำหน่าย)
  3. sales/checkout (หน้าขายหน้าร้าน — สำคัญสุด)
  4. เอกสารอื่นๆ (quotations, PO, GR, transfers, tax invoices)
  5. ลบ localStorage/workspaceSnapshot ออกทั้งหมดเมื่อทุกโมดูลย้ายครบ

## Dev

ไม่มี build step — เป็น static HTML/JS ล้วน เปิด `index.html` ตรงๆ ได้เลย

### Tests

รันชุดตรวจ syntax และ regression tests ที่ไม่ต้องติดตั้ง dependency เพิ่มได้ทันทีหลัง clone:

```sh
npm test
```

ชุดเริ่มต้นจะไม่รวมไฟล์ `*-browser.test.js` ซึ่งต้องใช้ Playwright จาก environment สำหรับทดสอบ browser โดยเฉพาะ

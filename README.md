# NOOSOL POS

ระบบ POS ร้านยา — เดิมเก็บข้อมูลทั้งหมดใน `localStorage` ของเบราว์เซอร์ (ไฟล์เดียว `legacy/POS_original.html`)
กำลัง migrate ไปใช้ **Supabase** เป็นฐานข้อมูลกลาง เพื่อให้เข้าถึงข้อมูลได้จากหลายเครื่อง/หลายผู้ใช้พร้อมกัน
และ deploy ผ่าน **Vercel** ที่โดเมน `pepos.vercel.app`

## สถานะปัจจุบัน

- [x] สร้าง GitHub repo (private)
- [ ] เชื่อม Supabase project
- [ ] สร้าง schema ตามรายการโมดูลด้านล่าง
- [ ] import GitHub repo เข้า Vercel (ตั้งชื่อโปรเจกต์ `pepos`)
- [ ] ทยอยแปลงแต่ละโมดูลจาก localStorage → Supabase (ดูรายการด้านล่าง)

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

**Milestone 0 (วันนี้):** deploy แอปเดิมขึ้น Vercel ตรงๆ ก่อน (ยังใช้ localStorage) เพื่อให้มี URL ใช้งานได้จริงระหว่างที่ทยอยรื้อ
**Milestone 1:** สร้าง schema Supabase ครบทุกตาราง + ตั้งค่า Auth
**Milestone 2+:** ย้ายทีละโมดูลตามลำดับความสำคัญ (แนะนำ: products/warehouses → sales/checkout → เอกสารอื่นๆ → users/auth)

## Dev

ไม่มี build step — เป็น static HTML/JS ล้วน เปิด `index.html` ตรงๆ ได้เลย

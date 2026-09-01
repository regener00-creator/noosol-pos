# NOOSOL POS

ระบบ POS ร้านยาที่ใช้ Supabase เป็นฐานข้อมูลกลาง รองรับหลายเครื่อง หลายคลัง LOT การตรวจนับสต๊อก เอกสารสต๊อก การยกเลิกบิล Audit Log และระบบเปิด–ปิดการชำระ

ใช้งานจริงผ่าน [pepo-pharmacy.vercel.app](https://pepo-pharmacy.vercel.app)

## โครงสร้างข้อมูล

- Supabase Auth ใช้สำหรับบัญชีเจ้าของและพนักงาน
- Supabase PostgreSQL เป็นแหล่งข้อมูลหลักของสินค้า เอกสาร ประวัติขาย สต๊อก LOT และการตั้งค่าร้าน
- `inventory_balances` และ `inventory_lots` เป็นแหล่งข้อมูลสต๊อกจริง
- IndexedDB เก็บแคชสินค้าและ product manifest เพื่อโหลดเฉพาะรายการที่เปลี่ยน
- `localStorage` เก็บเฉพาะสถานะอุปกรณ์และข้อมูลร่างที่จำเป็นต่อการกู้คืน ไม่เก็บแคตตาล็อกสินค้าหรือประวัติขายทั้งหมด
- การเปลี่ยนสต๊อกและการจบรายการขายทำผ่าน RPC แบบ atomic

Supabase project ref: `tgwqmpvdjyxwivjxceoq`

## การพัฒนา

โปรแกรมเป็น static HTML/JavaScript ไม่มี build step

รันชุดตรวจ syntax และ regression tests:

```sh
npm test
```

ไฟล์ `*-browser.test.js` ใช้สำหรับการตรวจด้วย browser environment แยกต่างหาก

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

โปรแกรมเป็น static HTML/JavaScript และสร้างไฟล์ Production แบบ minify ก่อน deploy

รันชุดตรวจ syntax และ regression tests:

```sh
pnpm test
```

ไฟล์ `*-browser.test.js` ใช้สำหรับการตรวจด้วย browser environment แยกต่างหาก

ตรวจชื่อและลำดับ Migration ใน GitHub:

```sh
pnpm run check:migrations
```

Workflow `Supabase Migration Parity` จะตรวจ GitHub เทียบกับฐานข้อมูลทุกวันและเมื่อ Migration บน `main` เปลี่ยน หากตั้ง Repository secret ชื่อ `SUPABASE_DB_URL` เป็น connection string ของฐานข้อมูล Supabase แล้ว กรณีที่เลข Migration สองฝั่งไม่ตรงกัน Workflow จะล้มเหลวและแจ้งเลขที่ขาดอย่างชัดเจน

รายการ RPC ที่ browser เรียกได้ถูกกำหนดไว้ใน `supabase/rpc-allowlist.json` และมี regression test ป้องกันไม่ให้แอปเพิ่ม RPC โดยไม่ประกาศสิทธิ์ก่อน

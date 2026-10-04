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

### ไฟล์ต้นฉบับตามหน้าที่

แก้โค้ดใน `src/` ตามงาน: `products/` สินค้า, `pos/` ขาย/ชำระเงิน, `sales/` ประวัติขายและคืนสินค้า, `inventory/` คลัง/LOT/โอน/ตรวจนับ, `documents/` เอกสาร, `printing/` งานพิมพ์, `reports/` รายงาน, `contacts/` และ `customers/` ผู้ติดต่อ/สมาชิก, `representatives/` ผู้แทน, `notes/` โน้ต, `promotions/` โปรโมชั่น, `settings/` ตั้งค่า, `dashboard/` ภาพรวม

ส่วนกลาง: `platform/` การโหลดและเริ่มโปรแกรม, `auth/` เข้าสู่ระบบและสิทธิ์, `sync/` ซิงก์/แคช/งานรอส่ง, `data/` การแปลงและแบ่งหน้าข้อมูล, `state/` สถานะร่วม, `shared/` ตัวช่วย, `ui/` การเปลี่ยนหน้าและผูกเหตุการณ์

`src/source-manifest.json` กำหนดลำดับประกอบไฟล์ โดยยังใช้ขอบเขตตัวแปรร่วมเดิมเพื่อรักษาการทำงานและ function hoisting ห้ามโหลดไฟล์เหล่านี้แยกเป็น `<script>` หรือเปลี่ยนเป็น ES modules โดยไม่ตรวจ dependencies ก่อน ฟังก์ชันผูกเหตุการณ์ข้ามหน้าที่ยังใช้ร่วมกันอยู่ใน `src/ui/events.js` ยังไม่ได้แยก state ของทุกหน้าจากกัน

`product-domain.js` เป็นกฎตรวจสินค้าแบบไม่มีผลข้างเคียง และ `excel-tools.js` เป็นงาน Excel ที่โหลดเมื่อใช้งาน ไฟล์ `app.js` ที่ root เป็นไฟล์สร้างอัตโนมัติสำหรับการพัฒนา **ห้ามแก้โดยตรงและไม่เก็บใน Git** ส่วน `public/` เป็นผลลัพธ์สำหรับเผยแพร่ ไม่ใช่ต้นฉบับ

เปิดตัวอย่างชุด Production ที่สร้างจากต้นฉบับล่าสุดบนเครื่อง:

```sh
pnpm dev
```

เข้า `http://127.0.0.1:4173` หลังแก้ไฟล์ให้หยุดแล้วรันใหม่เพื่อสร้างชุดล่าสุด ตัวอย่างนี้ยังใช้ปลายทาง Supabase ที่แอปตั้งไว้ จึงไม่ควรใช้สร้างข้อมูลทดลองในบัญชีร้านจริง; ชุดทดสอบอัตโนมัติใช้ข้อมูลจำลองและตัดการเชื่อมต่อข้อมูลจริง

หากใช้ static server ของตนเองที่ root ให้รัน `pnpm run prepare:dev` ก่อนและหลังแก้ `src/` เสมอ ชุดทดสอบหน้าจอจะสร้างไฟล์นี้ให้อัตโนมัติ ส่วน `pnpm run build` อ่านไฟล์ต้นฉบับโดยตรง ไม่พึ่ง `app.js` ที่อาจเก่า

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

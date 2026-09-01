# Migration workflow

- `baseline/` เก็บโครงสร้างที่มีอยู่ก่อนเริ่มใช้ migration history
- `migrations/` ต้องมีชื่อและ timestamp ตรงกับรายการใน Supabase Production
- migration ใหม่ต้องสร้างชื่อเพียงครั้งเดียวและใช้ SQL ชุดเดียวกันทั้งใน Git และ Production
- หลังเปลี่ยน schema ต้องทดสอบคำสั่งที่เกี่ยวข้องและตรวจ Supabase Advisors ทุกครั้ง

ประวัติถูกปรับให้ตรงกับ Production เมื่อ 1 กันยายน 2026 และแก้ปัญหาเลข `0045` ซ้ำแล้ว

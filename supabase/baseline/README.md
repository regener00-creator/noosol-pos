# Supabase baseline

ไฟล์ `0001` ถึง `0005` เป็นโครงสร้างตั้งต้นที่ถูกสร้างก่อนเริ่มบันทึก
ประวัติ migration แบบ timestamp ใน Supabase Production จึงเก็บไว้ในโฟลเดอร์นี้
แทนที่จะปะปนกับ migration ที่ Supabase ติดตามอยู่จริง

การสร้างฐานข้อมูลทดสอบใหม่ให้ทำตามลำดับนี้:

1. ใช้ไฟล์ baseline ในโฟลเดอร์นี้เรียงจาก `0001` ถึง `0005`
2. ใช้ไฟล์ใน `../migrations` เรียงตาม timestamp
3. ตรวจ Security และ Performance Advisor ก่อนนำไปใช้งาน

ห้ามย้าย baseline กลับเข้า `migrations` หรือเปลี่ยนเลข timestamp ของไฟล์ที่ติดตามแล้ว
เพราะจะทำให้ประวัติในเครื่องไม่ตรงกับ Production

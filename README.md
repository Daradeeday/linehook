# LINE Webhook Receiver for Vercel

โปรเจกต์นี้ใช้เป็นตัวกลางระหว่าง LINE Messaging API และ Google Apps Script

โครงสร้างการทำงาน:

1. LINE ส่ง webhook มาที่ Vercel
2. Vercel ตรวจสอบ `x-line-signature`
3. ถ้าถูกต้อง Vercel จะส่ง body เดิมต่อไปยัง Google Apps Script
4. Google Apps Script บันทึกลง Google Sheets และส่ง LINE push/review flow ต่อ

## ไฟล์สำคัญ

- `api/webhook.js` รับ LINE webhook และ forward ไป Apps Script
- `api/health.js` health check endpoint
- `.env.example` ตัวอย่าง environment variables
- `vercel.json` กำหนด runtime

## สิ่งที่ต้องเตรียม

- LINE Messaging API channel
- Channel secret จาก LINE Developers
- Google Apps Script Web App URL ของคุณ
- บัญชี Vercel

## ตั้งค่า Environment Variables บน Vercel

เพิ่มตัวแปรต่อไปนี้ใน Project Settings > Environment Variables

- `LINE_CHANNEL_SECRET`
- `APPS_SCRIPT_WEB_APP_URL`

ตัวอย่าง:

```env
LINE_CHANNEL_SECRET=your_line_channel_secret
APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

## Deploy ขึ้น Vercel

### วิธีผ่าน GitHub

1. สร้าง repository ใหม่บน GitHub
2. อัปโหลดไฟล์โปรเจกต์นี้ขึ้น repository
3. ไปที่ Vercel แล้วกด Import Project
4. เลือก repository นี้
5. เพิ่ม Environment Variables ให้ครบ
6. Deploy

## URL ที่จะได้หลัง deploy

- Health check: `https://YOUR-PROJECT.vercel.app/api/health`
- Webhook: `https://YOUR-PROJECT.vercel.app/api/webhook`

## ตั้งค่าใน LINE Developers

นำ URL นี้ไปใส่ในช่อง Webhook URL:

```text
https://YOUR-PROJECT.vercel.app/api/webhook
```

จากนั้นกด Verify

## วิธีทดสอบเบื้องต้น

### Health check
เปิด:

```text
https://YOUR-PROJECT.vercel.app/api/health
```

ควรได้ JSON สถานะ `ok: true`

### ทดสอบ webhook endpoint
คำสั่งนี้เอาไว้เช็กว่า route ตอบได้จริง แต่จะไม่ผ่าน signature verification ถ้าไม่ใช้ signature จริงจาก LINE:

```bash
curl -i -X POST https://YOUR-PROJECT.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -H "x-line-signature: dummy" \
  -d '{"destination":"test","events":[]}'
```

ถ้า signature ไม่ถูกต้อง จะได้ `401` ซึ่งถือว่าปกติ

## หมายเหตุสำคัญ

- Webhook route นี้ตั้งใจให้ LINE เรียกเท่านั้น
- ถ้าอยากให้ Apps Script รู้ว่า request มาจาก Vercel สามารถเช็ก header `X-Forwarded-By` ได้
- ถ้า Apps Script ตอบไม่สำเร็จ ระบบจะคืน `502` กลับ

## คำแนะนำสำหรับ Apps Script

ใน Apps Script ของคุณสามารถใช้โค้ดเดิมต่อได้เลย แต่ควรเช็กเพิ่มได้ว่า request ถูก forward มาจาก Vercel หรือไม่

ตัวอย่าง:

```javascript
function doPost(e) {
  // ใช้โค้ดเดิมของคุณต่อได้
}
```

## เช็กลำดับการตั้งค่า

1. Deploy Apps Script ให้เรียบร้อย
2. Deploy โปรเจกต์นี้ขึ้น Vercel
3. ตั้งค่า environment variables บน Vercel
4. เอา URL `/api/webhook` ไปใส่ใน LINE Developers
5. กด Verify
6. ทดสอบส่งข้อความหา bot

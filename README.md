# มิเตอร์ห้องเรา (Room Meter Log)

เว็บแอปจดเลขมิเตอร์ไฟฟ้าของห้องพักจากมือถือ หน้าเว็บอยู่บน **GitHub Pages** ข้อมูลเก็บใน **Google Sheets** ผ่าน **Apps Script API** (มี PIN ป้องกัน)

```
GitHub Pages (index.html, sw.js, manifest)  ← แก้หน้าเว็บที่นี่ commit แล้วอัปเดตทันที
        │  fetch POST (text/plain JSON + PIN)
        ▼
Apps Script Web App (apps-script/Code.gs)   ← API อย่างเดียว แทบไม่ต้องแก้
        │
        ▼
Google Sheet: ชีต Readings, Settings
```

## ความสามารถ

- จดเลขมิเตอร์จากมือถือ จดย้อนหลังได้ และเตือนเมื่อเลขที่กรอกน้อยกว่าครั้งก่อน
- **ไม่ต้องจดทุกวัน:** วันที่ไม่ได้จด ระบบจะเฉลี่ยหน่วยที่ใช้ให้เท่า ๆ กัน ส่วนวันหลังจดล่าสุดจะประมาณจากอัตราการใช้ช่วง 14 วันล่าสุด
- คาดการณ์ค่าไฟของรอบบิลปัจจุบัน (ราคาต่อหน่วย + ค่าบริการ + ค่าขั้นต่ำ)
- กราฟรายวัน (30/60/90 วัน) และกราฟเทียบรายรอบบิล พร้อมเทียบกับรอบก่อนเป็น %
- นำเข้าข้อมูลเดิมจาก .xlsx / .csv หรือวางข้อความ รองรับปี พ.ศ. และชื่อเดือนไทย
- PWA: เพิ่มลงหน้าจอโฮมได้ เปิดหน้าได้แม้ไม่มีเน็ต และแสดงข้อมูลล่าสุดที่เคยโหลดไว้

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าเว็บทั้งหมด (HTML/CSS/JS) ตัวแปร `API_URL` ชี้ไปที่ Apps Script |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | PWA |
| `apps-script/Code.gs` | API ฝั่ง Apps Script (`doPost`) |
| `apps-script/appsscript.json` | manifest ของโปรเจกต์ Apps Script |

## API

`POST <API_URL>` body เป็น JSON แบบ `text/plain` (ไม่ต้องผ่าน CORS preflight)

```json
{ "pin": "****", "action": "getData", "args": [] }
```

| action | args |
|---|---|
| `getData` | – |
| `saveReading` | `["2026-10-16", 1330, "หมายเหตุ"]` |
| `deleteReading` | `["2026-10-16"]` |
| `saveSettings` | `[{ "rate": 5, "fee": 0, "cycleDay": 1, "minCharge": 0 }]` |
| `importReadings` | `[[{ "k": "2026-10-01", "v": 1290, "note": "" }]]` |
| `wipeAll` | – |

ตอบกลับเป็น `{ "ok": true, "data": ... }` หรือ `{ "ok": false, "error": "bad_pin" }`

## แก้ไข / อัปเดต

- **หน้าเว็บ:** แก้ `index.html` ใน GitHub แล้ว commit ระบบ GitHub Pages จะอัปเดตภายใน 1–2 นาที (ถ้าเปลี่ยนไฟล์ PWA ให้เพิ่มเลขเวอร์ชันใน `CACHE` ของ `sw.js` ด้วย)
- **API:** แก้ใน Apps Script editor แล้วไปที่ **Deploy → จัดการการทำให้ใช้งานได้ → แก้ไข → เวอร์ชันใหม่** จากนั้นคัดลอกโค้ดกลับมาไว้ที่ `apps-script/Code.gs`
- **เปลี่ยน PIN:** Apps Script → การตั้งค่าโครงการ → พร็อพเพอร์ตี้ของสคริปต์ → แก้ค่า `PIN` (ไม่ต้อง deploy ใหม่) ห้ามใส่ PIN จริงไว้ในไฟล์ใน repo

## ติดตั้งใหม่ตั้งแต่ต้น

1. เปิด Google Sheet → **ส่วนขยาย → Apps Script** แล้ววางโค้ดจาก `apps-script/Code.gs`
2. ตั้ง Script Property ชื่อ `PIN`
3. (ไม่บังคับ) รัน `migrateOldSheet` เพื่อย้ายข้อมูลจากชีต `บันทึกรายวัน`
4. **Deploy → เว็บแอป** โดยตั้ง "เรียกใช้ในฐานะ: ฉัน" และ "ผู้มีสิทธิ์เข้าถึง: ทุกคน" แล้วนำ URL `/exec` ไปใส่ใน `API_URL` ของ `index.html`
5. เปิด GitHub Pages (Settings → Pages → Deploy from branch `main` / root)

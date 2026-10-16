# มิเตอร์ห้องเรา (Room Meter Log)

เว็บแอปสำหรับจดเลขมิเตอร์ไฟฟ้าของห้องพักจากมือถือ ทำงานบน Google Apps Script และเก็บข้อมูลไว้ใน Google Sheets

## ความสามารถ

- จดเลขมิเตอร์จากมือถือ จดย้อนหลังได้ และเตือนเมื่อเลขที่กรอกน้อยกว่าครั้งก่อน
- **ไม่ต้องจดทุกวัน:** วันที่ไม่ได้จด ระบบจะเฉลี่ยหน่วยที่ใช้ให้เท่า ๆ กัน ส่วนวันหลังจดล่าสุดจะประมาณจากอัตราการใช้ช่วง 14 วันล่าสุด
- คาดการณ์ค่าไฟของรอบบิลปัจจุบัน (ราคาต่อหน่วยคงที่ + ค่าบริการ + ค่าขั้นต่ำ)
- กราฟรายวัน (30/60/90 วัน) และกราฟเทียบรายรอบบิล (ดูเป็นบาทหรือหน่วย) พร้อมเทียบกับรอบก่อนเป็น %
- นำเข้าข้อมูลเดิมจาก .xlsx / .csv หรือวางข้อความ รองรับปี พ.ศ. และชื่อเดือนไทย

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `apps-script/Code.gs` | ฝั่งเซิร์ฟเวอร์: อ่าน/เขียนชีต, API ที่หน้าเว็บเรียก, ฟังก์ชันย้ายข้อมูลเดิม |
| `apps-script/Index.html` | หน้าเว็บ (HTML/CSS/JS ไฟล์เดียว) |
| `apps-script/appsscript.json` | manifest ของโปรเจกต์ (ใช้กับ clasp) |

## ชีตที่ใช้ (สร้างให้อัตโนมัติ)

- **Readings:** วันที่ (`yyyy-mm-dd`) | เลขมิเตอร์ | หมายเหตุ | บันทึกเมื่อ
- **Settings:** `rate`, `fee`, `cycleDay`, `minCharge`

## ติดตั้ง

1. เปิด Google Sheet แล้วไปที่ **ส่วนขยาย → Apps Script**
2. วางโค้ดจาก `Code.gs` ลงในไฟล์ `.gs` และสร้างไฟล์ HTML ชื่อ `Index` แล้ววางโค้ดจาก `Index.html`
3. (ไม่บังคับ) ถ้ามีข้อมูลเดิมในชีต `บันทึกรายวัน` ให้รันฟังก์ชัน `migrateOldSheet` หนึ่งครั้ง
4. **Deploy → การทำให้ใช้งานได้รายการใหม่ → เว็บแอป**
   - เรียกใช้ในฐานะ: ฉัน
   - ผู้มีสิทธิ์เข้าถึง: เฉพาะตัวฉัน (หรือทุกคนที่มีบัญชี Google)
5. เปิด URL ที่ลงท้ายด้วย `/exec` บนมือถือ แล้วเพิ่มลงหน้าจอโฮม

ทุกครั้งที่แก้โค้ด ต้องไปที่ **Deploy → จัดการการทำให้ใช้งานได้ → แก้ไข → เวอร์ชันใหม่**

## ซิงก์ GitHub ↔ Apps Script อัตโนมัติ

ให้ GitHub เป็นต้นฉบับ แก้โค้ดใน `apps-script/` แล้ว push ขึ้น `main` จากนั้น workflow **Deploy to Apps Script** จะทำงานเอง:

1. `clasp push` อัปโหลดโค้ดไปที่โปรเจกต์ Apps Script
2. `clasp deploy` อัปเดต deployment เดิม ลิงก์ `/exec` จึงไม่เปลี่ยน

ถ้าแก้โค้ดในหน้า Apps Script โดยตรง ให้ไปที่แท็บ **Actions → Pull from Apps Script → Run workflow** แล้ว workflow จะดึงโค้ดกลับมา commit ลง repo ให้

> `clasp push` จะ**แทนที่ไฟล์ทั้งหมด**ในโปรเจกต์ Apps Script ด้วยไฟล์ใน `apps-script/` ไฟล์อื่นที่อยู่ในโปรเจกต์จะถูกลบ

### ตั้งค่าครั้งแรก

1. เปิด Apps Script API ที่ https://script.google.com/home/usersettings
2. ในเครื่องที่มี Node.js ให้รัน

   ```bash
   npx @google/clasp@2.4.2 login
   ```

   ล็อกอินด้วยบัญชี Google ที่เป็นเจ้าของสคริปต์ แล้วจะได้ไฟล์ `~/.clasprc.json` (Windows: `C:\Users\<ชื่อ>\.clasprc.json`)
3. ใน GitHub ไปที่ **Settings → Secrets and variables → Actions → New repository secret** แล้วเพิ่ม 3 ตัว:

   | Secret | ค่า |
   |---|---|
   | `CLASPRC_JSON` | เนื้อหาทั้งหมดของไฟล์ `.clasprc.json` |
   | `SCRIPT_ID` | Apps Script → การตั้งค่าโครงการ → รหัสสคริปต์ |
   | `DEPLOYMENT_ID` | Deploy → จัดการการทำให้ใช้งานได้ → รหัสการทำให้ใช้งานได้ |

4. ไปที่ **Actions → Deploy to Apps Script → Run workflow** เพื่อทดสอบ

`CLASPRC_JSON` คือสิทธิ์เข้าถึงบัญชี Google ของคุณ ห้ามใส่ไว้ในไฟล์ใน repo ให้เก็บเป็น secret เท่านั้น

### ใช้กับ clasp (ทางเลือก)

```bash
npm i -g @google/clasp
clasp login
cd apps-script
clasp clone <SCRIPT_ID>   # หรือสร้าง .clasp.json เอง
clasp push
```

`.clasp.json` มี Script ID ของโปรเจกต์ จึงอยู่ใน `.gitignore`

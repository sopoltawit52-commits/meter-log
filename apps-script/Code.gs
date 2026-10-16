/**
 * มิเตอร์ห้องเรา — Google Apps Script API (backend)
 * หน้าเว็บอยู่ที่ GitHub Pages แล้วเรียก API นี้ด้วย POST (text/plain JSON)
 *   body: { "pin": "...", "action": "getData|saveReading|deleteReading|saveSettings|importReadings|wipeAll", "args": [...] }
 *   PIN เก็บใน Script Properties ชื่อ PIN (ไม่ได้อยู่ในโค้ด)
 *
 * ชีตที่ใช้ (สร้างให้อัตโนมัติ):
 *   Readings : วันที่ (yyyy-mm-dd) | เลขมิเตอร์ | หมายเหตุ | บันทึกเมื่อ
 *   Settings : key | value   (rate, fee, cycleDay, minCharge)
 */

const READINGS = 'Readings';
const SETTINGS = 'Settings';
const OLD_SHEET = 'บันทึกรายวัน';          // ชีตเดิมของคุณ
const AUTO_FILL_NOTE = 'เติมเฉลี่ยอัตโนมัติ'; // แถวที่เคยเติมเฉลี่ย จะไม่ถูกย้าย
const DEFAULTS = { rate: 5, fee: 0, cycleDay: 1, minCharge: 0 };

// ---------- web API ----------
const ACTIONS = {
  getData: () => getData(),
  saveReading: (k, v, note) => saveReading(k, v, note),
  deleteReading: (k) => deleteReading(k),
  saveSettings: (st) => saveSettings(st),
  importReadings: (list) => importReadings(list),
  wipeAll: () => wipeAll()
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkPin_(pin) {
  const want = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!want) throw new Error('ยังไม่ได้ตั้ง PIN ใน Script Properties');
  return String(pin || '') === want;
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!checkPin_(req.pin)) return json_({ ok: false, error: 'bad_pin' });
    const fn = ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: 'unknown_action' });
    const data = fn.apply(null, Array.isArray(req.args) ? req.args : []);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, app: 'meter-log', hint: 'use POST' });
}

// รันครั้งเดียวจาก editor เพื่อตั้ง PIN (แก้ค่าก่อนรัน แล้วลบค่าออกก่อน commit)
function setPin() {
  PropertiesService.getScriptProperties().setProperty('PIN', 'CHANGE_ME');
}

// ---------- menu in the spreadsheet ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚡ มิเตอร์')
    .addItem('ย้ายข้อมูลจากชีต "' + OLD_SHEET + '"', 'migrateOldSheet')
    .addItem('เรียงชีต Readings ตามวันที่', 'sortReadings')
    .addToUi();
}

// ---------- sheet helpers ----------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function readingsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(READINGS);
  if (!sh) {
    sh = ss.insertSheet(READINGS);
    sh.getRange(1, 1, 1, 4).setValues([['วันที่', 'เลขมิเตอร์', 'หมายเหตุ', 'บันทึกเมื่อ']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');   // เก็บวันที่เป็นข้อความ yyyy-mm-dd ป้องกัน Sheets แปลงเอง
    sh.getRange('D:D').setNumberFormat('yyyy-mm-dd hh:mm');
    sh.setColumnWidth(1, 110); sh.setColumnWidth(3, 220); sh.setColumnWidth(4, 140);
  }
  return sh;
}

function settingsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS);
    sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]).setFontWeight('bold');
    const rows = Object.keys(DEFAULTS).map(k => [k, DEFAULTS[k]]);
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  return sh;
}

function toKey_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const s = String(d).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function readMap_() {
  const sh = readingsSheet_();
  const last = sh.getLastRow();
  const map = {};
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, 3).getValues().forEach(r => {
    const k = toKey_(r[0]);
    const v = Number(r[1]);
    if (k && r[1] !== '' && isFinite(v)) map[k] = { v: v, note: String(r[2] || '') };
  });
  return map;
}

function readSettings_() {
  const sh = settingsSheet_();
  const out = Object.assign({}, DEFAULTS);
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).getValues().forEach(r => {
    if (r[0] !== '') out[String(r[0])] = Number(r[1]);
  });
  return out;
}

function withLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function validKey_(k) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new Error('รูปแบบวันที่ไม่ถูกต้อง: ' + k);
}

// upsert many rows at once: list = [{k, v, note}]
function upsert_(list) {
  const sh = readingsSheet_();
  const last = sh.getLastRow();
  const index = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach((r, i) => {
      const k = toKey_(r[0]); if (k) index[k] = i + 2;
    });
  }
  const now = new Date();
  const append = [];
  list.forEach(o => {
    validKey_(o.k);
    const v = Number(o.v);
    if (!isFinite(v) || v < 0) throw new Error('เลขมิเตอร์ไม่ถูกต้อง: ' + o.v);
    const row = [o.k, v, String(o.note || ''), now];
    if (index[o.k]) sh.getRange(index[o.k], 1, 1, 4).setValues([row]);
    else { append.push(row); index[o.k] = -1; }
  });
  if (append.length) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, append.length, 1).setNumberFormat('@');
    sh.getRange(start, 1, append.length, 4).setValues(append);
  }
}

// ---------- API called from Index.html ----------
function getData() {
  return { readings: readMap_(), settings: readSettings_() };
}

function saveReading(k, v, note) {
  withLock_(() => upsert_([{ k: k, v: v, note: note }]));
  return getData();
}

function importReadings(list) {
  if (!Array.isArray(list) || !list.length) return getData();
  withLock_(() => { upsert_(list); sortReadings(); });
  return getData();
}

function deleteReading(k) {
  validKey_(k);
  withLock_(() => {
    const sh = readingsSheet_();
    const last = sh.getLastRow();
    if (last < 2) return;
    const vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (toKey_(vals[i][0]) === k) sh.deleteRow(i + 2);
    }
  });
  return getData();
}

function saveSettings(s) {
  withLock_(() => {
    const sh = settingsSheet_();
    const cur = readSettings_();
    const merged = Object.assign(cur, {
      rate: Number(s.rate), fee: Number(s.fee) || 0,
      cycleDay: Math.min(28, Math.max(1, Number(s.cycleDay) || 1)),
      minCharge: Number(s.minCharge) || 0
    });
    if (!(merged.rate > 0)) throw new Error('ราคาต่อหน่วยต้องมากกว่า 0');
    const rows = Object.keys(merged).map(k => [k, merged[k]]);
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).clearContent();
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  });
  return getData();
}

function wipeAll() {
  withLock_(() => {
    const sh = readingsSheet_();
    if (sh.getLastRow() >= 2) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  return getData();
}

function sortReadings() {
  const sh = readingsSheet_();
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, 4).sort({ column: 1, ascending: true });
}

// อ่านวันที่จากชีตเดิม: รับได้ทั้งค่า Date และข้อความ "20/5/2026, 7:00:00" หรือ "28/5/2026"
function oldDateKey_(x) {
  if (x instanceof Date) return toKey_(x);
  const m = String(x || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  let y = Number(m[3]); if (y > 2400) y -= 543;
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}

// ---------- one-time migration from your old sheet ----------
// ย้ายเฉพาะวันที่จดจริงจากชีต "บันทึกรายวัน" (ข้ามแถว "เติมเฉลี่ยอัตโนมัติ")
// และอ่านราคาต่อหน่วยจากเซลล์ B1
function migrateOldSheet() {
  const old = ss_().getSheetByName(OLD_SHEET);
  if (!old) throw new Error('ไม่พบชีต "' + OLD_SHEET + '"');
  const values = old.getDataRange().getValues();
  // หาแถวหัวตารางที่มีคำว่า "วันที่"
  let h = values.findIndex(r => String(r[0]).indexOf('วันที่') >= 0);
  if (h < 0) h = 0;
  const head = values[h].map(String);
  const cDate = 0;
  let cMeter = head.findIndex(x => x.indexOf('มิเตอร์') >= 0); if (cMeter < 0) cMeter = 1;
  let cNote = head.findIndex(x => x.indexOf('หมายเหตุ') >= 0);
  const byDay = {};
  for (let i = h + 1; i < values.length; i++) {
    const r = values[i];
    const note = cNote >= 0 ? String(r[cNote] || '') : '';
    if (note.indexOf(AUTO_FILL_NOTE) >= 0) continue;
    const k = oldDateKey_(r[cDate]);
    if (!k || r[cMeter] === '' || !isFinite(Number(r[cMeter]))) continue;
    byDay[k] = { k: k, v: Number(r[cMeter]), note: note }; // วันเดียวกันเก็บแถวสุดท้าย
  }
  const list = Object.keys(byDay).sort().map(k => byDay[k]);
  withLock_(() => { upsert_(list); sortReadings(); });

  const rate = Number(values[0][1]);
  if (rate > 0) saveSettings(Object.assign(readSettings_(), { rate: rate }));

  const msg = 'ย้ายแล้ว ' + list.length + ' วัน' + (list.length ? ' (' + list[0].k + ' ถึง ' + list[list.length - 1].k + ')' : '') +
              (rate > 0 ? '\nราคาต่อหน่วย: ' + rate + ' บาท' : '');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}

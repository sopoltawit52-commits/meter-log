/**
 * มิเตอร์ห้องเรา — Google Apps Script API (backend)
 * หน้าเว็บอยู่ที่ GitHub Pages แล้วเรียก API นี้ด้วย POST (text/plain JSON)
 *   body: { "pin": "...", "action": "...", "args": [...] }
 *   PIN เก็บใน Script Properties ชื่อ PIN (ไม่ได้อยู่ในโค้ด)
 *
 * ชีตที่ใช้ (สร้าง/เพิ่มคอลัมน์ให้อัตโนมัติ):
 *   Readings : วันที่ (yyyy-mm-dd) | เลขมิเตอร์ | หมายเหตุ | บันทึกเมื่อ | เวลาที่จด (HH:mm) | เปลี่ยนมิเตอร์ (Y)
 *   Settings : key | value   (rate, fee, cycleDay, minCharge, budget, remindDays, remindCycle)
 *   Bills    : รอบเริ่ม (yyyy-mm-dd) | หน่วยตามบิล | ยอดเงิน (บาท) | หมายเหตุ | บันทึกเมื่อ
 *   Places   : วันย้ายเข้า | เวลา | ชื่อที่พัก | rate | fee | cycleDay | minCharge | เลขย้ายออก | วันย้ายออก | เวลาย้ายออก
 *              (แถวสุดท้าย = ที่พักปัจจุบัน; ราคา/วันตัดรอบใน Settings จะซิงก์กับแถวนี้)
 *
 * จดได้หลายครั้งต่อวัน: แต่ละแถวระบุด้วย วันที่ + เวลาที่จด
 * ความปลอดภัย: ใส่ PIN ผิด 5 ครั้ง ล็อก 15 นาที; ไม่มีคำสั่ง "ลบทั้งหมด" ทาง API (ลบเองในชีต หรือรัน wipeAll ใน editor)
 * สำรองอัตโนมัติ: ทุก 7 วัน (ตอนมีการบันทึก) คัดลอกชีต Readings/Places/Bills เป็นชีตซ่อน "Backup yyyy-mm-dd" เก็บ 4 ชุดล่าสุด
 * อีเมลเตือน (ไม่ได้เปิดใช้): dailyCheck / installTriggers
 */

const READINGS = 'Readings';
const SETTINGS = 'Settings';
const BILLS = 'Bills';
const PLACES = 'Places';
const PLACE_KEYS = ['rate', 'fee', 'cycleDay', 'minCharge'];
const OLD_SHEET = 'บันทึกรายวัน';          // ชีตเดิมของคุณ
const AUTO_FILL_NOTE = 'เติมเฉลี่ยอัตโนมัติ'; // แถวที่เคยเติมเฉลี่ย จะไม่ถูกย้าย
const APP_URL = 'https://sopoltawit52-commits.github.io/meter-log/';
const DEFAULTS = { rate: 5, fee: 0, cycleDay: 1, minCharge: 0, budget: 0, remindDays: 0, remindCycle: 0 };
const DEFAULT_TIME = '12:00';             // ใช้คำนวณเมื่อแถวไม่มีเวลาที่จด
const PIN_MAX_FAIL = 5;                   // ใส่ PIN ผิดได้กี่ครั้ง
const PIN_LOCK_SEC = 15 * 60;             // ล็อกนานเท่าไร (วินาที)
const BACKUP_EVERY_DAYS = 7;
const BACKUP_KEEP = 4;
const WRITE_ACTIONS = ['saveReading', 'deleteReading', 'saveSettings', 'importReadings', 'saveBill', 'deleteBill', 'moveIn', 'undoMove'];

// ---------- web API ----------
const ACTIONS = {
  getData: () => getData(),
  saveReading: (k, v, note, t, reset, origK, origT) => saveReading(k, v, note, t, reset, origK, origT),
  deleteReading: (k, t) => deleteReading(k, t),
  saveSettings: (st) => saveSettings(st),
  importReadings: (list) => importReadings(list),
  saveBill: (k, units, amount, note) => saveBill(k, units, amount, note),
  deleteBill: (k) => deleteBill(k),
  moveIn: (o) => moveIn(o),
  undoMove: () => undoMove()
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// คืนค่า 'ok' | 'bad' | 'locked'  (นับครั้งที่ผิดใน CacheService, ล็อกชั่วคราวเมื่อผิดเกินกำหนด)
function checkPin_(pin) {
  const want = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!want) throw new Error('ยังไม่ได้ตั้ง PIN ใน Script Properties');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pinFails') || 0);
  if (fails >= PIN_MAX_FAIL) return 'locked';
  if (String(pin || '') === want) { if (fails) cache.remove('pinFails'); return 'ok'; }
  cache.put('pinFails', String(fails + 1), PIN_LOCK_SEC);
  Utilities.sleep(800);   // ชะลอการเดา
  return fails + 1 >= PIN_MAX_FAIL ? 'locked' : 'bad';
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const pinState = checkPin_(req.pin);
    if (pinState === 'locked') return json_({ ok: false, error: 'locked', minutes: PIN_LOCK_SEC / 60 });
    if (pinState !== 'ok') return json_({ ok: false, error: 'bad_pin' });
    const fn = ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: 'unknown_action' });
    if (WRITE_ACTIONS.indexOf(req.action) >= 0) { try { autoBackup_(); } catch (be) { console.warn('backup: ' + be); } }
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
    .addItem('เติมเวลาที่จดจากชีต "' + OLD_SHEET + '"', 'backfillTimesFromOldSheet')
    .addItem('เรียงชีต Readings ตามวันที่', 'sortReadings')
    .addItem('สำรองข้อมูลตอนนี้', 'backupNow')
    .addSeparator()
    .addItem('เปิดอีเมลเตือนรายวัน (ติดตั้ง trigger)', 'installTriggers')
    .addItem('ทดสอบส่งอีเมลเตือนตอนนี้', 'testReminderEmail')
    .addToUi();
}

// ---------- sheet helpers ----------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone() || 'Asia/Bangkok'; }

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
  // คอลัมน์ใหม่ (เพิ่มให้ชีตเดิมอัตโนมัติ)
  if (String(sh.getRange(1, 5).getValue()) === '') {
    sh.getRange(1, 5, 1, 2).setValues([['เวลาที่จด', 'เปลี่ยนมิเตอร์']]).setFontWeight('bold');
    sh.getRange('E:E').setNumberFormat('@');
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

function billsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(BILLS);
  if (!sh) {
    sh = ss.insertSheet(BILLS);
    sh.getRange(1, 1, 1, 5).setValues([['รอบเริ่ม', 'หน่วยตามบิล', 'ยอดเงิน (บาท)', 'หมายเหตุ', 'บันทึกเมื่อ']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('E:E').setNumberFormat('yyyy-mm-dd hh:mm');
  }
  return sh;
}

function toKey_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
  const s = String(d).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function toTime_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, tz_(), 'HH:mm');
  const m = String(x == null ? '' : x).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return '';
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}

// ทุกแถวที่จด (จดได้หลายครั้งต่อวัน) เรียงตามวันที่+เวลา: [{k, t, v, note, reset, row}]
function readList_() {
  const sh = readingsSheet_();
  const last = sh.getLastRow();
  const out = [];
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 6).getValues().forEach((r, i) => {
    const k = toKey_(r[0]);
    const v = Number(r[1]);
    if (!k || r[1] === '' || !isFinite(v)) return;
    let t = toTime_(r[4]);
    // แถวเก่าที่ไม่มีเวลา: ถ้าบันทึกในวันเดียวกับวันที่จด ใช้เวลาที่กดบันทึก
    if (!t && r[3] instanceof Date && toKey_(r[3]) === k) t = toTime_(r[3]);
    out.push({ k: k, t: t, v: v, note: String(r[2] || ''), reset: String(r[5]).toUpperCase() === 'Y', row: i + 2 });
  });
  return out.sort((a, b) => (a.k + (a.t || DEFAULT_TIME)) < (b.k + (b.t || DEFAULT_TIME)) ? -1 : 1);
}

// แบบเดิม: 1 ค่าต่อวัน (ครั้งล่าสุดของวัน) ใช้กับหน้าเว็บรุ่นเก่า / การคำนวณฝั่งเซิร์ฟเวอร์
function readMap_() {
  const map = {};
  readList_().forEach(o => { map[o.k] = { v: o.v, note: o.note, t: o.t, reset: o.reset }; });
  return map;
}

function readSettings_() {
  const out = readBaseSettings_();
  const pl = readPlaces_();
  const cur = pl[pl.length - 1];
  PLACE_KEYS.forEach(k => { out[k] = cur[k]; });
  out.placeName = cur.name;
  out.placeStart = cur.start;
  return out;
}

function readBaseSettings_() {
  const sh = settingsSheet_();
  const out = Object.assign({}, DEFAULTS);
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).getValues().forEach(r => {
    if (r[0] !== '') out[String(r[0])] = Number(r[1]);
  });
  return out;
}

function readBills_() {
  const sh = billsSheet_();
  const last = sh.getLastRow();
  const map = {};
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, 4).getValues().forEach(r => {
    const k = toKey_(r[0]);
    const amount = Number(r[2]);
    if (!k || r[2] === '' || !isFinite(amount)) return;
    const units = r[1] === '' ? null : Number(r[1]);
    map[k] = { amount: amount, units: isFinite(units) ? units : null, note: String(r[3] || '') };
  });
  return map;
}

function placesSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(PLACES);
  if (!sh) {
    sh = ss.insertSheet(PLACES);
    sh.getRange(1, 1, 1, 10).setValues([['วันย้ายเข้า', 'เวลา', 'ชื่อที่พัก', 'rate', 'fee', 'cycleDay', 'minCharge', 'เลขย้ายออก', 'วันย้ายออก', 'เวลาย้ายออก']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:B').setNumberFormat('@'); sh.getRange('I:J').setNumberFormat('@');
  }
  if (sh.getLastRow() < 2) {   // ครั้งแรก: สร้างที่พักแรกจาก Settings เดิม เริ่มตั้งแต่วันที่จดครั้งแรก
    const base = readBaseSettings_();
    const keys = Object.keys(readMap_()).sort();
    const start = keys.length ? keys[0] : Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
    sh.getRange(2, 1, 1, 10).setValues([[start, '', 'ที่พักแรก', base.rate, base.fee, base.cycleDay, base.minCharge, '', '', '']]);
  }
  return sh;
}

function readPlaces_() {
  const sh = placesSheet_();
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
  return rows.map((r, i) => ({
    row: i + 2, start: toKey_(r[0]), t: toTime_(r[1]), name: String(r[2] || ('ที่พัก ' + (i + 1))),
    rate: Number(r[3]) || DEFAULTS.rate, fee: Number(r[4]) || 0,
    cycleDay: Math.min(28, Math.max(1, Number(r[5]) || 1)), minCharge: Number(r[6]) || 0,
    outV: r[7] === '' ? null : Number(r[7]), outK: toKey_(r[8]), outT: toTime_(r[9])
  })).filter(p => p.start).sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
}

function placeOut_(p) {
  const o = { start: p.start, t: p.t, name: p.name, rate: p.rate, fee: p.fee, cycleDay: p.cycleDay, minCharge: p.minCharge };
  if (p.outV != null && isFinite(p.outV) && p.outK) { o.outV = p.outV; o.outK = p.outK; o.outT = p.outT; }
  return o;
}

function withLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function validKey_(k) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new Error('รูปแบบวันที่ไม่ถูกต้อง: ' + k);
}

// upsert many rows at once: list = [{k, v, note, t, reset, origK?, origT?}]
//   ระบุแถวด้วย วันที่+เวลา; ถ้าไม่มีเวลา (เช่นนำเข้า) จับคู่ด้วยวันที่อย่างเดียว
//   origK/origT = แถวเดิมที่ต้องการแก้ (ใช้ตอนแก้บันทึก เปลี่ยนวันที่/เวลาได้)
function upsert_(list) {
  const sh = readingsSheet_();
  const last = sh.getLastRow();
  const rows = [];
  if (last >= 2) sh.getRange(2, 1, last - 1, 5).getValues().forEach((r, i) => rows.push({ k: toKey_(r[0]), t: toTime_(r[4]), row: i + 2 }));
  const find = (k, t) => {
    if (!k) return null;
    const hit = rows.find(x => x.k === k && (t ? x.t === t : true));
    return hit || null;
  };
  const now = new Date();
  list.forEach(o => {
    validKey_(o.k);
    const v = Number(o.v);
    if (!isFinite(v) || v < 0) throw new Error('เลขมิเตอร์ไม่ถูกต้อง: ' + o.v);
    const t = toTime_(o.t);
    const row = [o.k, v, String(o.note || ''), now, t, o.reset ? 'Y' : ''];
    let hit = o.origK ? find(o.origK, toTime_(o.origT)) : null;
    if (o.origK && !hit) throw new Error('ไม่พบบันทึกเดิม ' + o.origK + ' ' + (o.origT || '') + ' (อาจถูกลบไปแล้ว)');
    if (!hit) hit = find(o.k, t);
    if (hit) {
      sh.getRange(hit.row, 1).setNumberFormat('@');
      sh.getRange(hit.row, 5).setNumberFormat('@');
      sh.getRange(hit.row, 1, 1, 6).setValues([row]);
      hit.k = o.k; hit.t = t;
    } else {
      const r = sh.getLastRow() + 1;
      sh.getRange(r, 1).setNumberFormat('@');
      sh.getRange(r, 5).setNumberFormat('@');
      sh.getRange(r, 1, 1, 6).setValues([row]);
      rows.push({ k: o.k, t: t, row: r });
    }
  });
}

// ---------- API ----------
function getData() {
  let triggerOk = false;
  try { triggerOk = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailyCheck'); } catch (e) {}
  const list = readList_().map(o => ({ k: o.k, t: o.t, v: o.v, note: o.note, reset: o.reset }));
  const map = {};
  list.forEach(o => { map[o.k] = { v: o.v, note: o.note, t: o.t, reset: o.reset }; });
  return { readings: map, readingList: list, settings: readSettings_(), bills: readBills_(), places: readPlaces_().map(placeOut_), triggerOk: triggerOk };
}

function saveReading(k, v, note, t, reset, origK, origT) {
  withLock_(() => { upsert_([{ k: k, v: v, note: note, t: t, reset: !!reset, origK: origK || '', origT: origT || '' }]); if (origK) sortReadings(); });
  return getData();
}

function importReadings(list) {
  if (!Array.isArray(list) || !list.length) return getData();
  withLock_(() => { upsert_(list); sortReadings(); });
  return getData();
}

// ลบบันทึก: ระบุวันที่ + เวลา (ถ้าไม่ระบุเวลา ลบทุกแถวของวันนั้น)
function deleteReading(k, t) {
  validKey_(k);
  const tt = toTime_(t);
  withLock_(() => {
    readList_().filter(o => o.k === k && (!tt || o.t === tt)).map(o => o.row).sort((a, b) => b - a)
      .forEach(r => readingsSheet_().deleteRow(r));
  });
  return getData();
}

function saveSettings(s) {
  let merged;
  withLock_(() => {
    const sh = settingsSheet_();
    const cur = readBaseSettings_();
    merged = Object.assign(cur, {
      rate: Number(s.rate), fee: Number(s.fee) || 0,
      cycleDay: Math.min(28, Math.max(1, Number(s.cycleDay) || 1)),
      minCharge: Number(s.minCharge) || 0
    });
    if (s.budget !== undefined) merged.budget = Math.max(0, Number(s.budget) || 0);
    if (s.remindDays !== undefined) merged.remindDays = Math.max(0, Math.min(30, Number(s.remindDays) || 0));
    if (s.remindCycle !== undefined) merged.remindCycle = Number(s.remindCycle) ? 1 : 0;
    if (!(merged.rate > 0)) throw new Error('ราคาต่อหน่วยต้องมากกว่า 0');
    const rows = Object.keys(merged).map(k => [k, merged[k]]);
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).clearContent();
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
    const pl = readPlaces_(), cp = pl[pl.length - 1], ps = placesSheet_();
    ps.getRange(cp.row, 4, 1, 4).setValues([[merged.rate, merged.fee, merged.cycleDay, merged.minCharge]]);
    if (s.placeName !== undefined && String(s.placeName).trim()) ps.getRange(cp.row, 3).setValue(String(s.placeName).trim());
  });
  if (merged.remindDays > 0 || merged.remindCycle || merged.budget > 0) {
    try { installTriggers(); } catch (e) { /* ยังไม่ได้อนุญาตสิทธิ์ ScriptApp: รัน installTriggers จาก editor */ }
  }
  return getData();
}

function saveBill(k, units, amount, note) {
  validKey_(k);
  const a = Number(amount);
  if (!isFinite(a) || a < 0) throw new Error('ยอดเงินไม่ถูกต้อง');
  const u = units === '' || units == null ? '' : Number(units);
  if (u !== '' && (!isFinite(u) || u < 0)) throw new Error('หน่วยไม่ถูกต้อง');
  withLock_(() => {
    const sh = billsSheet_();
    const last = sh.getLastRow();
    const row = [k, u, a, String(note || ''), new Date()];
    let at = -1;
    if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach((r, i) => { if (toKey_(r[0]) === k) at = i + 2; });
    if (at < 0) { at = last + 1; sh.getRange(at, 1).setNumberFormat('@'); }
    sh.getRange(at, 1, 1, 5).setValues([row]);
    if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, 5).sort({ column: 1, ascending: true });
  });
  return getData();
}

function deleteBill(k) {
  validKey_(k);
  withLock_(() => {
    const sh = billsSheet_();
    const last = sh.getLastRow();
    if (last < 2) return;
    const vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = vals.length - 1; i >= 0; i--) if (toKey_(vals[i][0]) === k) sh.deleteRow(i + 2);
  });
  return getData();
}

// ย้ายที่พัก: o = { name, k, t, v, rate, fee, cycleDay, minCharge, outV, outK, outT }
function moveIn(o) {
  o = o || {};
  validKey_(o.k);
  const v = Number(o.v);
  if (!isFinite(v) || v < 0) throw new Error('เลขมิเตอร์แรกของที่พักใหม่ไม่ถูกต้อง');
  if (!(Number(o.rate) > 0)) throw new Error('ราคาต่อหน่วยต้องมากกว่า 0');
  withLock_(() => {
    const pl = readPlaces_(), cur = pl[pl.length - 1];
    if (o.k <= cur.start) throw new Error('วันย้ายเข้าต้องอยู่หลังวันเริ่มของที่พักปัจจุบัน (' + cur.start + ')');
    const later = readList_().filter(x => x.k >= o.k).map(x => x.k + (x.t ? ' ' + x.t : ''));
    if (later.length) throw new Error('มีบันทึกตั้งแต่วันย้ายเข้าแล้ว (' + later.join(', ') + ') ลบออกก่อน หรือเลือกวันย้ายเข้าใหม่');
    const ps = placesSheet_();
    if (o.outV !== '' && o.outV != null) {
      const ov = Number(o.outV);
      if (!isFinite(ov) || ov < 0) throw new Error('เลขย้ายออกไม่ถูกต้อง');
      const ok = o.outK || o.k; validKey_(ok);
      if (ok > o.k) throw new Error('วันย้ายออกต้องไม่หลังวันย้ายเข้า');
      ps.getRange(cur.row, 8, 1, 3).setNumberFormats([['0.##', '@', '@']]).setValues([[ov, ok, toTime_(o.outT)]]);
    }
    const nr = ps.getLastRow() + 1;
    ps.getRange(nr, 1, 1, 2).setNumberFormat('@');
    ps.getRange(nr, 1, 1, 10).setValues([[o.k, toTime_(o.t), String(o.name || 'ที่พักใหม่').trim(),
      Number(o.rate), Number(o.fee) || 0, Math.min(28, Math.max(1, Number(o.cycleDay) || 1)), Number(o.minCharge) || 0, '', '', '']]);
    upsert_([{ k: o.k, v: v, note: 'ย้ายเข้า ' + String(o.name || '').trim(), t: o.t, reset: true }]);
    sortReadings();
    // ซิงก์ Settings ให้เป็นราคาของที่พักใหม่
    const sh = settingsSheet_();
    const merged = Object.assign(readBaseSettings_(), { rate: Number(o.rate), fee: Number(o.fee) || 0,
      cycleDay: Math.min(28, Math.max(1, Number(o.cycleDay) || 1)), minCharge: Number(o.minCharge) || 0 });
    const rows = Object.keys(merged).map(k => [k, merged[k]]);
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).clearContent();
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  });
  return getData();
}

// ยกเลิกการย้ายครั้งล่าสุด: ลบแถวที่พักล่าสุด + บันทึกวันย้ายเข้า แล้วกลับไปใช้ราคาของที่พักก่อนหน้า
function undoMove() {
  withLock_(() => {
    const pl = readPlaces_();
    if (pl.length < 2) throw new Error('ยังไม่เคยย้ายที่พัก');
    const cur = pl[pl.length - 1], prev = pl[pl.length - 2];
    const all = readList_();
    const first = all.find(o => o.k === cur.start && (!cur.t || o.t === cur.t)) || all.find(o => o.k === cur.start);
    const later = all.filter(o => o !== first && (o.k > cur.start || (o.k === cur.start && (o.t || DEFAULT_TIME) > (cur.t || '00:00'))));
    if (later.length) throw new Error('มีบันทึกหลังวันย้ายเข้าแล้ว ' + later.length + ' รายการ ลบออกก่อนจึงจะยกเลิกการย้ายได้');
    const ps = placesSheet_();
    ps.deleteRow(cur.row);
    ps.getRange(prev.row, 8, 1, 3).clearContent();
    if (first) readingsSheet_().deleteRow(first.row);
    const ss = settingsSheet_();
    const merged = Object.assign(readBaseSettings_(), { rate: prev.rate, fee: prev.fee, cycleDay: prev.cycleDay, minCharge: prev.minCharge });
    const rows = Object.keys(merged).map(k => [k, merged[k]]);
    ss.getRange(2, 1, Math.max(ss.getLastRow() - 1, 1), 2).clearContent();
    ss.getRange(2, 1, rows.length, 2).setValues(rows);
  });
  return getData();
}

// ไม่เปิดให้เรียกผ่าน API แล้ว — ถ้าจำเป็นจริง ๆ ให้รันจาก Apps Script editor
function wipeAll() {
  withLock_(() => {
    const sh = readingsSheet_();
    if (sh.getLastRow() >= 2) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  return getData();
}

function sortReadings() {
  const sh = readingsSheet_();
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, 6).sort([{ column: 1, ascending: true }, { column: 5, ascending: true }]);
}

// ---------- automatic backup (ไม่ต้องใช้สิทธิ์เพิ่ม) ----------
function autoBackup_(force) {
  const props = PropertiesService.getScriptProperties();
  const lastB = Number(props.getProperty('lastBackup') || 0);
  if (!force && Date.now() - lastB < BACKUP_EVERY_DAYS * 86400000) return '';
  const ss = ss_();
  const name = 'Backup ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HHmm');
  const bk = ss.insertSheet(name, ss.getSheets().length);
  let col = 1;
  [READINGS, PLACES, BILLS, SETTINGS].forEach(n => {
    const src = ss.getSheetByName(n);
    if (!src || src.getLastRow() < 1) return;
    const vals = src.getRange(1, 1, src.getLastRow(), src.getLastColumn()).getValues();
    bk.getRange(1, col).setValue('== ' + n + ' ==').setFontWeight('bold');
    bk.getRange(2, col, vals.length, vals[0].length).setNumberFormat('@').setValues(vals.map(r => r.map(c => c instanceof Date ? Utilities.formatDate(c, tz_(), 'yyyy-MM-dd HH:mm') : c)));
    col += vals[0].length + 1;
  });
  bk.hideSheet();
  // เก็บแค่ BACKUP_KEEP ชุดล่าสุด
  ss.getSheets().filter(x => x.getName().indexOf('Backup ') === 0).sort((a, b) => a.getName() < b.getName() ? 1 : -1)
    .slice(BACKUP_KEEP).forEach(x => ss.deleteSheet(x));
  props.setProperty('lastBackup', String(Date.now()));
  return name;
}

// รันเองจาก editor ได้: สำรองทันที
function backupNow() { const n = autoBackup_(true); Logger.log('สำรองแล้ว: ' + n); return n; }

// ---------- usage model (ตรรกะเดียวกับหน้าเว็บ) ----------
const DAYMS_ = 86400000;
function dn_(k) { const p = k.split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / DAYMS_); }
function keyOf_(n) { const d = new Date(n * DAYMS_); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
function nowX_() {
  const tz = tz_(), now = new Date();
  const hm = Utilities.formatDate(now, tz, 'HH:mm').split(':').map(Number);
  return dn_(Utilities.formatDate(now, tz, 'yyyy-MM-dd')) + (hm[0] * 60 + hm[1]) / 1440;
}
function buildModel_(map) {
  const R = Object.keys(map).sort().map(k => {
    const t = (map[k].t || DEFAULT_TIME).split(':').map(Number);
    return { k: k, x: dn_(k) + (t[0] * 60 + t[1]) / 1440, v: map[k].v, reset: map[k].reset };
  });
  const iv = [];
  const rateIn = (x0, x1) => {
    let u = 0, len = 0;
    iv.forEach(s => { const o = Math.min(s.x1, x1) - Math.max(s.x0, x0); if (o > 0) { u += s.u * o / (s.x1 - s.x0); len += o; } });
    return len > 0 ? u / len : null;
  };
  for (let i = 1; i < R.length; i++) {
    const a = R[i - 1], b = R[i], span = b.x - a.x;
    if (span <= 0) continue;
    let u = b.v - a.v, est = span > 1.5;
    if (b.reset || u < 0) { const r = rateIn(a.x - 14, a.x); u = r == null ? 0 : r * span; est = true; }
    iv.push({ x0: a.x, x1: b.x, u: u, est: est });
  }
  const last = R.length ? R[R.length - 1] : null;
  const rate = last && iv.length ? rateIn(last.x - 14, last.x) : null;
  function units(x0, x1) {
    let known = 0, fc = 0;
    iv.forEach(s => { const o = Math.min(s.x1, x1) - Math.max(s.x0, x0); if (o > 0) known += s.u * o / (s.x1 - s.x0); });
    if (last && rate != null) { const o = x1 - Math.max(x0, last.x); if (o > 0) fc = rate * o; }
    return { known: known, fc: fc, total: known + fc };
  }
  return { R: R, iv: iv, last: last, rate: rate, units: units };
}
function cycleOf_(n, D) {
  const d = new Date(n * DAYMS_), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const s = d.getUTCDate() >= D ? Math.round(Date.UTC(y, m, D) / DAYMS_) : Math.round(Date.UTC(y, m - 1, D) / DAYMS_);
  const sd = new Date(s * DAYMS_);
  return { s: s, e: Math.round(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth() + 1, D) / DAYMS_) - 1 };
}
function billOf_(units, st) { return Math.max(units * st.rate + (st.fee || 0), st.minCharge || 0); }

// ---------- daily email check ----------
function installTriggers() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailyCheck');
  if (!has) ScriptApp.newTrigger('dailyCheck').timeBased().everyDays(1).atHour(19).inTimezone(tz_()).create();
  return 'ติดตั้งแล้ว: dailyCheck ทุกวันราว 19:00';
}

function buildReminder_(forceTest) {
  const st = readSettings_();
  const all = readMap_(), map = {};
  Object.keys(all).forEach(k => { if (k >= st.placeStart) map[k] = all[k]; });   // เฉพาะที่พักปัจจุบัน
  const M = buildModel_(map);
  const nowX = nowX_(), today = Math.floor(nowX);
  const lines = [];
  const props = PropertiesService.getScriptProperties();
  if (st.remindDays > 0 && M.last) {
    const ago = today - Math.floor(M.last.x);
    if (ago >= st.remindDays) lines.push('• ไม่ได้จดเลขมิเตอร์มา ' + ago + ' วันแล้ว (ล่าสุด ' + M.last.k + ' เลข ' + M.last.v + ')');
  }
  const c = cycleOf_(today, st.cycleDay || 1);
  if (c.s < dn_(st.placeStart)) c.s = dn_(st.placeStart);
  if (st.remindCycle && today === c.s && (!M.last || Math.floor(M.last.x) !== today)) {
    lines.push('• วันนี้เป็นวันตัดรอบบิล (วันที่ ' + st.cycleDay + ') จดเลขมิเตอร์ไว้จะได้เทียบกับบิลหอได้ตรง');
  }
  if (st.budget > 0 && M.last) {
    const tot = M.units(c.s, c.e + 1).total;
    const bill = billOf_(tot, st);
    const flag = keyOf_(c.s);
    if (bill > st.budget && (forceTest || props.getProperty('budgetAlerted') !== flag)) {
      lines.push('• คาดว่าค่าไฟรอบนี้ ~' + Math.round(bill) + ' บาท เกินงบ ' + st.budget + ' บาท (~' + Math.round(tot) + ' หน่วย)');
      if (!forceTest) props.setProperty('budgetAlerted', flag);
    }
  }
  return lines;
}

function dailyCheck() {
  const lines = buildReminder_(false);
  if (!lines.length) return;
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '⚡ มิเตอร์ห้องเรา: ' + lines.length + ' เรื่องที่ควรดู',
    lines.join('\n') + '\n\nเปิดแอป: ' + APP_URL + '\n\n(ปิดการเตือนได้ที่ แอป → ตั้งค่า → การแจ้งเตือน)');
}

function testReminderEmail() {
  const lines = buildReminder_(true);
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '⚡ มิเตอร์ห้องเรา: ทดสอบอีเมลเตือน',
    (lines.length ? lines.join('\n') : 'ตอนนี้ยังไม่มีเรื่องต้องเตือน (อีเมลนี้เป็นการทดสอบ)') + '\n\nเปิดแอป: ' + APP_URL);
  return 'ส่งแล้ว';
}

// อ่านวันที่จากชีตเดิม: รับได้ทั้งค่า Date และข้อความ "20/5/2026, 7:00:00" หรือ "28/5/2026"
function oldDateKey_(x) {
  if (x instanceof Date) return toKey_(x);
  const m = String(x || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  let y = Number(m[3]); if (y > 2400) y -= 543;
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}
function oldTime_(x) {
  if (x instanceof Date) { const t = toTime_(x); return t === '00:00' ? '' : t; } // 00:00 = ไม่มีเวลา
  const m = String(x || '').match(/,\s*(\d{1,2}:\d{2})/);
  return m ? toTime_(m[1]) : '';
}

// ---------- one-time migration from your old sheet ----------
function readOldSheet_() {
  const old = ss_().getSheetByName(OLD_SHEET);
  if (!old) throw new Error('ไม่พบชีต "' + OLD_SHEET + '"');
  const values = old.getDataRange().getValues();
  let h = values.findIndex(r => String(r[0]).indexOf('วันที่') >= 0);
  if (h < 0) h = 0;
  const head = values[h].map(String);
  let cMeter = head.findIndex(x => x.indexOf('มิเตอร์') >= 0); if (cMeter < 0) cMeter = 1;
  const cNote = head.findIndex(x => x.indexOf('หมายเหตุ') >= 0);
  const byDay = {};
  for (let i = h + 1; i < values.length; i++) {
    const r = values[i];
    const note = cNote >= 0 ? String(r[cNote] || '') : '';
    if (note.indexOf(AUTO_FILL_NOTE) >= 0) continue;
    const k = oldDateKey_(r[0]);
    if (!k || r[cMeter] === '' || !isFinite(Number(r[cMeter]))) continue;
    byDay[k] = { k: k, v: Number(r[cMeter]), note: note, t: oldTime_(r[0]) }; // วันเดียวกันเก็บแถวสุดท้าย
  }
  return { values: values, byDay: byDay };
}

// ย้ายเฉพาะวันที่จดจริงจากชีต "บันทึกรายวัน" (ข้ามแถว "เติมเฉลี่ยอัตโนมัติ") และอ่านราคาต่อหน่วยจากเซลล์ B1
function migrateOldSheet() {
  const o = readOldSheet_();
  const list = Object.keys(o.byDay).sort().map(k => o.byDay[k]);
  withLock_(() => { upsert_(list); sortReadings(); });
  const rate = Number(o.values[0][1]);
  if (rate > 0) saveSettings(Object.assign(readSettings_(), { rate: rate }));
  const msg = 'ย้ายแล้ว ' + list.length + ' วัน' + (list.length ? ' (' + list[0].k + ' ถึง ' + list[list.length - 1].k + ')' : '') +
              (rate > 0 ? '\nราคาต่อหน่วย: ' + rate + ' บาท' : '');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}

// เติมเวลาที่จดให้แถวใน Readings ที่ยังไม่มีเวลา โดยดูจากชีตเดิม (เฉพาะวันที่และเลขมิเตอร์ตรงกัน)
function backfillTimesFromOldSheet() {
  const o = readOldSheet_();
  let n = 0;
  withLock_(() => {
    const sh = readingsSheet_();
    const last = sh.getLastRow();
    if (last < 2) return;
    const rows = sh.getRange(2, 1, last - 1, 5).getValues();
    rows.forEach((r, i) => {
      const k = toKey_(r[0]), src = o.byDay[k];
      if (!src || !src.t || toTime_(r[4]) || Number(r[1]) !== src.v) return;
      sh.getRange(i + 2, 5).setNumberFormat('@').setValue(src.t); n++;
    });
  });
  const msg = 'เติมเวลาที่จดแล้ว ' + n + ' แถว';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}

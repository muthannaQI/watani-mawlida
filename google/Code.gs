/**
 * وطني ومولدة — Google Apps Script bound to the customer's own Google Sheet.
 *
 * The ESP32 POSTs its readings here; the app (GitHub Pages) reads them with GET.
 * Everything is stored in this spreadsheet, inside the customer's Google account:
 *   sheet «السجل»      one row per outage: line | start | end | minutes
 *   sheet «الإعدادات»   house name + "has generator" checkbox
 * Live state (last seen, current on/off, open rows, keys) is kept in Script Properties.
 *
 * Deploy: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Then use the sheet menu «⚡ وطني ومولدة» → «الإعداد والروابط».
 */
const APP_URL = 'https://muthannaqi.github.io/watani-mawlida/app.html';
const LOG = 'السجل', SETTINGS = 'الإعدادات';
const LINE_AR = { grid: 'الوطنية', gen: 'المولدة' };
const ONLINE_MS = 3 * 60000;     // the device reports every 60 s
const MAX_DAYS = 95;
const OFF = '+03:00';            // Asia/Baghdad, no DST
const P = PropertiesService.getScriptProperties();

// ───────────── menu / setup ─────────────
function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚡ وطني ومولدة')
    .addItem('الإعداد والروابط', 'showSetup')
    .addItem('تغيير رابط Web app', 'resetUrl')
    .addSeparator()
    .addItem('مفاتيح جديدة (يتوقف الرابط القديم والجهاز)', 'rotateKeys')
    .addToUi();
}

function ensureSetup_() {
  const ss = SpreadsheetApp.getActive();
  let st = ss.getSheetByName(SETTINGS);
  if (!st) {
    st = ss.insertSheet(SETTINGS, 0);
    st.setRightToLeft(true);
    st.getRange('A1:A2').setValues([['اسم البيت'], ['يوجد اشتراك مولدة']]).setFontWeight('bold');
    st.getRange('B1').setValue('بيتي');
    st.getRange('B2').insertCheckboxes().setValue(true);
    st.setColumnWidth(1, 170); st.setColumnWidth(2, 220);
  }
  let log = ss.getSheetByName(LOG);
  if (!log) { log = ss.insertSheet(LOG); log.setRightToLeft(true); }
  if (log.getLastRow() === 0) {
    log.appendRow(['الخط', 'بداية الانقطاع', 'نهاية الانقطاع', 'المدة (دقيقة)']);
    log.getRange('A1:D1').setFontWeight('bold');
    log.setFrozenRows(1);
    log.getRange('B:C').setNumberFormat('yyyy-mm-dd hh:mm');
    log.setColumnWidths(1, 4, 150);
  }
  if (!P.getProperty('DEVICE_KEY')) P.setProperty('DEVICE_KEY', hex_(32));
  if (!P.getProperty('VIEW_KEY')) P.setProperty('VIEW_KEY', hex_(24));
  ['Sheet1', 'ورقة1', 'الورقة1'].forEach((n) => { const s = ss.getSheetByName(n); if (s && ss.getSheets().length > 2 && s.getLastRow() === 0) ss.deleteSheet(s); });
}

function hex_(n) { let s = ''; while (s.length < n) s += Utilities.getUuid().replace(/-/g, ''); return s.slice(0, n); }

function webUrl_(ask) {
  let url = P.getProperty('WEB_URL');
  if (url) return url;
  const auto = ScriptApp.getService().getUrl();
  if (auto && /\/exec$/.test(auto)) url = auto;
  else if (ask) {
    const ui = SpreadsheetApp.getUi();
    const r = ui.prompt('رابط Web app',
      'في Apps Script: نشر ← إدارة عمليات النشر ← انسخ رابط Web app (ينتهي بـ /exec) والصقه هنا:', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return null;
    url = r.getResponseText().trim();
  }
  if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    if (ask) SpreadsheetApp.getUi().alert('الرابط غير صحيح: يجب أن يبدأ بـ https://script.google.com/macros/s/ وينتهي بـ /exec');
    return null;
  }
  P.setProperty('WEB_URL', url);
  return url;
}

function resetUrl() { P.deleteProperty('WEB_URL'); showSetup(); }

function rotateKeys() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('مفاتيح جديدة', 'رابط التطبيق الحالي سيتوقف، والجهاز يحتاج إدخال المفتاح الجديد. متابعة؟', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  P.setProperties({ DEVICE_KEY: hex_(32), VIEW_KEY: hex_(24) });
  showSetup();
}

function showSetup() {
  ensureSetup_();
  const url = webUrl_(true);
  if (!url) return;
  const id = url.match(/\/s\/([\w-]+)\/exec/)[1];
  const app = APP_URL + '?s=' + id + '&k=' + P.getProperty('VIEW_KEY');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
<style>body{font-family:Arial,sans-serif;font-size:14px;margin:4px}h3{margin:14px 0 4px;font-size:15px}
code{display:block;direction:ltr;word-break:break-all;background:#f1f3f4;border-radius:6px;padding:8px;font-size:12.5px;user-select:all}
button{margin-top:6px;border:0;border-radius:6px;background:#1a73e8;color:#fff;padding:6px 12px;cursor:pointer}
#qr{text-align:center;margin:8px 0}#qr svg{width:190px;height:190px}.n{color:#5f6368;font-size:12.5px}</style></head><body>
<h3>📱 رابط التطبيق (لصاحب البيت)</h3>
<div id="qr"></div><code id="a">${esc(app)}</code><button onclick="cp('a')">نسخ</button>
<h3>🔧 لصفحة إعداد الجهاز (Watani-Setup)</h3>
<div class="n">Script URL</div><code id="u">${esc(url)}</code><button onclick="cp('u')">نسخ</button>
<div class="n" style="margin-top:8px">Device key</div><code id="k">${esc(P.getProperty('DEVICE_KEY'))}</code><button onclick="cp('k')">نسخ</button>
<p class="n">كل البيانات تُحفظ في هذا الملف داخل حسابك فقط. لا تشارك المفتاح أو الرابط إلا مع أهل البيت.</p>
<script>
function cp(id){const r=document.createRange();r.selectNodeContents(document.getElementById(id));const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('copy');}
try{const q=qrcode(0,'M');q.addData(${JSON.stringify(app)});q.make();document.getElementById('qr').innerHTML=q.createSvgTag({cellSize:5,margin:2,scalable:true});}catch(e){}
</script></body></html>`;
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(440).setHeight(640), '⚡ وطني ومولدة');
}

// ───────────── helpers ─────────────
const out_ = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const bit_ = (v) => (v === 1 || v === '1' || v === true) ? true : (v === 0 || v === '0' || v === false) ? false : null;
const forSecs_ = (v) => { const n = Number(v); return isFinite(n) ? Math.min(Math.max(n, 0), 86400) : 0; };
const lineOf_ = (a) => (a === LINE_AR.grid || a === 'grid') ? 'grid' : (a === LINE_AR.gen || a === 'gen') ? 'gen' : null;

function settings_() {
  const st = SpreadsheetApp.getActive().getSheetByName(SETTINGS);
  if (!st) return { name: '', hasGen: true };
  const v = st.getRange('B1:B2').getValues();
  return { name: String(v[0][0] || ''), hasGen: v[1][0] !== false };
}

function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(LOG) || (ensureSetup_(), ss.getSheetByName(LOG));
}

// Row of the open outage for a line: use the remembered row if it still matches, else search from the bottom.
function openRow_(sh, line, hint) {
  const last = sh.getLastRow();
  if (hint > 1 && hint <= last) {
    const r = sh.getRange(hint, 1, 1, 3).getValues()[0];
    if (lineOf_(r[0]) === line && r[2] === '') return hint;
  }
  if (last < 2) return 0;
  const vals = sh.getRange(2, 1, last - 1, 3).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (lineOf_(vals[i][0]) === line && vals[i][2] === '') return i + 2;
  return 0;
}

// ───────────── device report (POST) ─────────────
function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'bad json' }); }
  const props = P.getProperties();
  if (!props.DEVICE_KEY || b.k !== props.DEVICE_KEY) return out_({ error: 'forbidden' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return out_({ error: 'busy' });
  try {
    const now = Date.now(), cfg = settings_();
    const upd = { LAST_SEEN: String(now) };
    if (!props.FIRST_SEEN) upd.FIRST_SEEN = String(now);
    const changes = [];
    let sh = null;
    for (const line of ['grid', 'gen']) {
      if (line === 'gen' && !cfg.hasGen) continue;
      const v = bit_(b[line]);
      if (v === null) continue;
      const prev = props['ON_' + line];                       // "true" | "false" | undefined
      const changed = prev === undefined ? !v : String(v) !== prev;
      if (changed) {
        sh = sh || logSheet_();
        const at = new Date(now - forSecs_(b[line + '_for']) * 1000);
        if (!v) {
          sh.appendRow([LINE_AR[line], at, '', '']);
          upd['OPEN_' + line] = String(sh.getLastRow());
        } else {
          const row = openRow_(sh, line, Number(props['OPEN_' + line] || 0));
          if (row) {
            const start = sh.getRange(row, 2).getValue();
            const end = (start instanceof Date && at < start) ? start : at;
            sh.getRange(row, 3, 1, 2).setValues([[end, start instanceof Date ? Math.round((end - start) / 60000) : '']]);
          }
          upd['OPEN_' + line] = '0';
        }
        changes.push({ line: line, on: v, at: at.toISOString() });
      }
      upd['ON_' + line] = String(v);
    }
    if (typeof b.fw === 'string') upd.FW = b.fw.slice(0, 20);
    if (isFinite(Number(b.rssi))) upd.RSSI = String(Math.round(Number(b.rssi)));
    P.setProperties(upd);
    return out_({ ok: true, changes: changes });
  } finally {
    lock.releaseLock();
  }
}

// ───────────── app view (GET) ─────────────
function doGet(e) {
  const p = (e && e.parameter) || {};
  const props = P.getProperties();
  if (!props.VIEW_KEY || p.k !== props.VIEW_KEY) return out_({ error: 'forbidden' });

  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  let fromD, toD;
  if (isDate(p.from) && isDate(p.to)) { fromD = new Date(p.from + 'T00:00:00' + OFF); toD = new Date(p.to + 'T23:59:59.999' + OFF); }
  else { const days = Math.min(Math.max(parseInt(p.days || '7', 10) || 7, 1), MAX_DAYS); toD = new Date(); fromD = new Date(toD.getTime() - days * 86400e3); }
  if (fromD > toD) { const t = fromD; fromD = toD; toD = t; }
  if (toD - fromD > MAX_DAYS * 86400e3) fromD = new Date(toD.getTime() - MAX_DAYS * 86400e3);

  const cfg = settings_(), sh = SpreadsheetApp.getActive().getSheetByName(LOG);
  const offs = { grid: [], gen: [] };
  if (sh && sh.getLastRow() > 1) {
    for (const r of sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()) {
      const line = lineOf_(r[0]);
      if (!line || !(r[1] instanceof Date)) continue;
      const end = r[2] instanceof Date ? r[2] : null;
      if (r[1] > toD || (end && end < fromD)) continue;
      offs[line].push({ started_at: r[1].toISOString(), ended_at: end ? end.toISOString() : null });
    }
  }
  const desc = (a, b) => (a.started_at < b.started_at ? 1 : -1);
  const last = Number(props.LAST_SEEN || 0), first = Number(props.FIRST_SEEN || 0);
  const state = (k) => props[k] === 'true' ? true : props[k] === 'false' ? false : null;
  return out_({
    name: cfg.name, has_gen: cfg.hasGen,
    online: !!last && Date.now() - last < ONLINE_MS,
    last_seen: last ? new Date(last).toISOString() : null,
    since: first ? new Date(first).toISOString() : null,
    from: fromD.toISOString(), to: toD.toISOString(),
    grid: { on: state('ON_grid'), offs: offs.grid.sort(desc) },
    gen: cfg.hasGen ? { on: state('ON_gen'), offs: offs.gen.sort(desc) } : null,
  });
}

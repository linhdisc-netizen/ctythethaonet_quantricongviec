/**
 * BACKEND của app quản lý đơn hàng – dán vào Google Sheet "Đóng đơn TTS- A LINH"
 * (Tiện ích mở rộng → Apps Script). Xem README.md.
 *
 * File này là BẢN MẪU. Thay 3 chuỗi __PW_...__ bằng mật khẩu thật (dài, ngẫu nhiên)
 * rồi mới dán vào Apps Script. KHÔNG đưa mật khẩu thật lên GitHub.
 *
 * AN TOÀN
 *  - Mọi yêu cầu phải có mật khẩu; mật khẩu quyết định vai trò (shop / kho / chu).
 *  - Chỉ đọc 2 sheet: "Tháng M/YYYY" (tháng hiện tại) và "Tồn tháng <tháng trước>".
 *  - Chỉ ghi vào sheet của bạn: cột J, K (Đã đóng / Đã giao), thêm dòng mới ở cuối, cột H sheet tồn.
 *  - Không xoá dòng nào của bạn. Mỗi lần ghi kiểm tra dòng còn đúng sản phẩm/size/màu/mã đơn, lệch thì bỏ qua.
 *  - Dữ liệu riêng của app nằm ở 3 sheet mới App_BinhLuan, App_LienKet, App_NhatKy (tự tạo, ở cuối).
 */
const PASSWORDS = { shop: '__PW_SHOP__', kho: '__PW_KHO__', chu: '__PW_CHU__' };

const TZ = Session.getScriptTimeZone();
const ORDER_COLS = ['J', 'K'];
const STOCK_COLS = ['H'];
const TAB_CMT = 'App_BinhLuan', TAB_LINK = 'App_LienKet', TAB_LOG = 'App_NhatKy';

function doGet() { return out({ ok: true }); }

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out({ error: 'JSON lỗi' }); }
  const role = roleOf(p.pw);
  if (!role) return out({ error: 'Sai mật khẩu' });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (p.action === 'login') return out({ role: role });
    if (p.action === 'load') return out(load(role));
    if (p.action === 'write') return out(write(p, role));
    return out({ error: 'Action không hợp lệ' });
  } catch (err) {
    return out({ error: String((err && err.message) || err) });
  } finally { lock.releaseLock(); }
}

function roleOf(pw) {
  if (!pw || typeof pw !== 'string') return null;
  for (const r in PASSWORDS) { if (PASSWORDS[r].indexOf('__PW_') !== 0 && PASSWORDS[r] === pw) return r; }
  return null;
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
const pad = n => (n < 10 ? '0' : '') + n;
const nowStr = () => Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
const col = L => L.charCodeAt(0) - 64;   // 'A' -> 1

/* ---------- Tìm sheet ---------- */
function findSheets() {
  const ss = SpreadsheetApp.getActive(), now = new Date();
  const m = now.getMonth() + 1, y = now.getFullYear(), pm = m === 1 ? 12 : m - 1;
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const by = {}; ss.getSheets().forEach(s => by[norm(s.getName())] = s);
  const orders = by[norm('Tháng ' + m + '/' + y)] || by[norm('Tháng ' + pad(m) + '/' + y)];
  const stock = by[norm('Tồn tháng ' + pm)] || by[norm('Tồn tháng ' + pad(pm))];
  if (!orders) throw new Error('Không thấy sheet "Tháng ' + m + '/' + y + '". Hãy tạo sheet tháng mới.');
  return { orders: orders, stock: stock || null };
}
function tab(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name, ss.getNumSheets()); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

/* ---------- Đọc ---------- */
function cell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : v;
}
function readSheet(sh, lastCol, firstRow) {
  const last = sh.getLastRow();
  if (last < firstRow) return [];
  const vals = sh.getRange(firstRow, 1, last - firstRow + 1, lastCol).getValues();
  const rows = [];
  vals.forEach((r, i) => {
    if (!r.some(v => v !== '' && v !== null)) return;
    const o = { row: firstRow + i };
    r.forEach((v, c) => { const x = cell(v); if (x !== '') o[String.fromCharCode(65 + c)] = x; });
    rows.push(o);
  });
  return rows;
}
function readTab(name, header, maxRows) {
  const sh = tab(name, header), last = sh.getLastRow();
  if (last < 2) return [];
  const from = Math.max(2, last - maxRows + 1);
  return sh.getRange(from, 1, last - from + 1, header.length).getValues().map(r => r.map(cell));
}
function load(role) {
  const s = findSheets();
  return {
    role: role, serverTime: nowStr(),
    ordersSheet: s.orders.getName(), stockSheet: s.stock ? s.stock.getName() : '',
    orders: readSheet(s.orders, 11, 3), stock: s.stock ? readSheet(s.stock, 9, 5) : [],
    comments: readTab(TAB_CMT, ['ts', 'role', 'key', 'text'], 3000),
    links: readTab(TAB_LINK, ['key', 'stockRow', 'ts'], 5000),
    log: readTab(TAB_LOG, ['ts', 'role', 'key', 'text'], 3000),
  };
}

/* ---------- Ghi ---------- */
function toDate(s) { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : (s || ''); }

function lastDataRow(sh, letter, minRow) {
  const last = sh.getLastRow();
  if (last < minRow) return minRow - 1;
  const v = sh.getRange(1, col(letter), last, 1).getValues();
  for (let i = v.length - 1; i >= minRow - 1; i--) if (String(v[i][0]).trim() !== '') return i + 1;
  return minRow - 1;
}
function snapshot(sh, lastCol) {
  const last = sh.getLastRow();
  return last < 1 ? [] : sh.getRange(1, 1, last, lastCol).getValues();
}
function matches(snap, row, expect) {
  const r = snap[row - 1];
  if (!r) return false;
  return Object.keys(expect || {}).every(k => String(r[col(k) - 1]).trim() === String(expect[k]).trim());
}

function write(p, role) {
  const s = findSheets();
  const res = { sets: [], appends: [], stockSets: [], stockAppends: [] };
  if ((p.appends || []).length && role === 'kho') throw new Error('Vai trò Kho không được thêm đơn');
  if ((p.stockAppends || []).length && role === 'shop') throw new Error('Vai trò Shop không được nhập kho');

  // Sheet đơn
  const oSnap = snapshot(s.orders, 11);
  (p.sets || []).forEach(x => {
    const bad = !(x.row >= 3) || Object.keys(x.cells).some(c => ORDER_COLS.indexOf(c) < 0);
    if (bad || !matches(oSnap, x.row, x.expect)) return res.sets.push({ ok: false });
    const c = x.cells;
    if ('J' in c && 'K' in c) s.orders.getRange(x.row, 10, 1, 2).setValues([[c.J, c.K]]);
    else Object.keys(c).forEach(k => s.orders.getRange(k + x.row).setValue(c[k]));
    res.sets.push({ ok: true });
  });
  const aps = p.appends || [];
  if (aps.length) {
    let row = lastDataRow(s.orders, 'B', 3) + 1, lastDate = '';
    for (let r = oSnap.length; r >= 3; r--) { const v = oSnap[r - 1][0]; if (v instanceof Date) { lastDate = Utilities.formatDate(v, TZ, 'yyyy-MM-dd'); break; } }
    const start = row, block = [];
    aps.forEach(x => {
      const v = x.vals || {}, line = [];
      'ABCDEFGHIJK'.split('').forEach(L => {
        let val = v[L] === undefined ? '' : v[L];
        if (L === 'A') { if (val && val !== lastDate) { lastDate = val; val = toDate(val); } else val = ''; }
        line.push(val);
      });
      block.push(line); res.appends.push({ ok: true, row: row++ });
    });
    s.orders.getRange(start, 1, block.length, 11).setValues(block);
  }

  // Sheet tồn
  if (s.stock) {
    const sSnap = snapshot(s.stock, 9);
    (p.stockSets || []).forEach(x => {
      const bad = !(x.row >= 5) || Object.keys(x.cells).some(c => STOCK_COLS.indexOf(c) < 0);
      if (bad || !matches(sSnap, x.row, x.expect)) return res.stockSets.push({ ok: false });
      Object.keys(x.cells).forEach(k => s.stock.getRange(k + x.row).setValue(toDate(x.cells[k])));
      res.stockSets.push({ ok: true });
    });
    const sa = p.stockAppends || [];
    if (sa.length) {
      let row = lastDataRow(s.stock, 'E', 5) + 1;
      const start = row, block = [];
      sa.forEach(x => {
        const v = x.vals || {};
        block.push(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map(L => L === 'B' ? toDate(v.B) : (v[L] === undefined ? '' : v[L])));
        res.stockAppends.push({ ok: true, row: row++ });
      });
      s.stock.getRange(start, 1, block.length, 9).setValues(block);
    }
  } else if ((p.stockSets || []).length || (p.stockAppends || []).length) {
    (p.stockSets || []).forEach(() => res.stockSets.push({ ok: false }));
    (p.stockAppends || []).forEach(() => res.stockAppends.push({ ok: false }));
  }

  // Dữ liệu riêng của app
  const keyOf = x => x.key || (x.append != null && aps[x.append] ? (aps[x.append].vals.E || 'r' + res.appends[x.append].row) : '');
  const ts = nowStr();
  if ((p.comments || []).length) {
    const sh = tab(TAB_CMT, ['ts', 'role', 'key', 'text']);
    p.comments.forEach(x => sh.appendRow([ts, role, keyOf(x), String(x.text || '').slice(0, 2000)]));
  }
  if ((p.log || []).length) {
    const sh = tab(TAB_LOG, ['ts', 'role', 'key', 'text']);
    p.log.forEach(x => sh.appendRow([ts, role, keyOf(x), String(x.text || '').slice(0, 500)]));
  }
  if ((p.unlinks || []).length) {
    const sh = tab(TAB_LINK, ['key', 'stockRow', 'ts']), last = sh.getLastRow();
    if (last >= 2) {
      const keys = sh.getRange(2, 1, last - 1, 1).getValues();
      for (let i = keys.length - 1; i >= 0; i--) if (p.unlinks.indexOf(String(keys[i][0])) >= 0) sh.deleteRow(i + 2);   // chỉ xoá dòng trong sheet riêng của app
    }
  }
  if ((p.links || []).length) {
    const sh = tab(TAB_LINK, ['key', 'stockRow', 'ts']);
    p.links.forEach(x => sh.appendRow([keyOf(x), x.stockRow, ts]));
  }
  SpreadsheetApp.flush();
  return res;
}

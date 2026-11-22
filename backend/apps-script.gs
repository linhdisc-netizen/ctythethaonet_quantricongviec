/**
 * BACKEND của app quản lý đơn hàng (phiên bản 2: theo ID, một sheet "Đơn hàng" cho mọi tháng).
 * Dán vào Apps Script của Google Sheet mới (xem README.md).
 *
 * File này là BẢN MẪU. Thay 3 chuỗi __PW_...__ bằng mật khẩu thật rồi mới dán vào Apps Script.
 * KHÔNG đưa mật khẩu thật lên GitHub.
 *
 * Nếu Apps Script được tạo từ "Tiện ích mở rộng → Apps Script" ngay trong Sheet thì để SHEET_ID trống.
 * Nếu tạo từ script.google.com (dự án độc lập) thì BẮT BUỘC dán ID của Sheet vào SHEET_ID,
 * không thì sẽ báo lỗi "không mở được sheet".
 */
const PASSWORDS = { shop: '__PW_SHOP__', kho: '__PW_KHO__', chu: '__PW_CHU__' };
const SHEET_ID = '';   // ID của Google Sheet: đoạn giữa /d/ và /edit trong link của Sheet

const TAB = { ORD: 'Đơn hàng', STK: 'Tồn kho', CMT: 'Bình luận', LOG: 'Nhật ký', CAT: 'Danh mục', CHK: 'Kiểm kho' };
const CHK_HEADER = ['Thời gian', 'Người kiểm', 'Sản phẩm', 'Size', 'Màu', 'Sổ sách', 'Thực tế', 'Chênh lệch', 'Xử lý'];
const ORD = { id: 'ID', date: 'Ngày', product: 'Sản phẩm', size: 'Size', color: 'Màu', code: 'Mã đơn', kem: 'Đóng kèm', src: 'Nguồn', st: 'Trạng thái', by: 'Người tạo', upd: 'Cập nhật lúc', note: 'Ghi chú' };
const STK = { id: 'ID', date: 'Ngày nhập', type: 'Loại', product: 'Sản phẩm', size: 'Size', color: 'Màu', ref: 'Mã đơn hoàn', st: 'Tình trạng', used: 'Ngày dùng', forOrder: 'Dùng cho đơn (ID)', note: 'Ghi chú' };
const STATUSES = ['Chờ đóng', 'Đã đóng', 'Đã giao', 'Không có hàng', 'Đã hủy', 'Đã hoàn'];
const ROLE_NAME = { shop: 'Shop', kho: 'Kho', chu: 'Chủ' };

/* ---------- Điểm vào ---------- */
function doGet() { return out({ ok: true }); }

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out({ error: 'JSON lỗi' }); }
  const role = roleOf(p.pw);
  if (!role) return out({ error: 'Sai mật khẩu' });
  if (p.action === 'login') return out({ role: role });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
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

/* ---------- Mở sheet / bảng ---------- */
let _ss = null;
function book() {
  if (_ss) return _ss;
  _ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
  if (!_ss) throw new Error('Script chưa gắn với Google Sheet. Hãy dán ID của Sheet vào SHEET_ID ở đầu file script.');
  return _ss;
}
// Sheet mới tạo/nhập từ Excel đôi khi chưa có múi giờ (trả về null) nên phải có phương án dự phòng
const tz = () => book().getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh';
const fmt = (d, f) => Utilities.formatDate(d, tz(), f);
const pad = n => (n < 10 ? '0' : '') + n;

// Đọc cả bảng vào bộ nhớ: {sh, h: {tên cột -> số cột (1..)}, rows: mảng giá trị (dòng 2 trở đi)}
function table(name, spec, create) {
  const ss = book();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    if (!create) throw new Error('Không thấy tab "' + name + '". Hãy dùng đúng file Excel mẫu và không đổi tên tab.');
    sh = ss.insertSheet(name, ss.getNumSheets()); sh.appendRow(create); sh.setFrozenRows(1);
  }
  const last = Math.max(sh.getLastRow(), 1), width = Math.max(sh.getLastColumn(), 1);
  const vals = sh.getRange(1, 1, last, width).getValues();
  const h = {};
  vals[0].forEach((v, i) => { if (v !== '') h[String(v).trim()] = i + 1; });
  if (spec) Object.keys(spec).forEach(k => { if (!h[spec[k]]) throw new Error('Tab "' + name + '" thiếu cột "' + spec[k] + '". Không đổi tên hay xóa cột ở dòng 1.'); });
  return { sh: sh, h: h, vals: vals, width: width };
}
const cellOf = (t, r, header) => t.vals[r][t.h[header] - 1];   // r: chỉ số trong vals (0 = dòng tiêu đề)

function norm(v) {
  if (v instanceof Date) return fmt(v, 'HH:mm:ss') === '00:00:00' ? fmt(v, 'yyyy-MM-dd') : fmt(v, "yyyy-MM-dd'T'HH:mm:ss");
  return v === null || v === undefined ? '' : v;
}
function rowObj(t, spec, r) {
  const o = { _row: r + 1 };
  Object.keys(spec).forEach(k => { o[k] = norm(cellOf(t, r, spec[k])); });
  return o;
}
function setCell(t, r, header, value) {
  t.sh.getRange(r + 1, t.h[header]).setValue(value);
  t.vals[r][t.h[header] - 1] = value;
}
function toDate(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || '');
  // Ghi ngày vào 12:00 trưa (không phải 00:00) để dù múi giờ Sheet là GMT hay Việt Nam thì ô vẫn hiện đúng ngày.
  return m ? Utilities.parseDate(s + 'T12:00:00', tz(), "yyyy-MM-dd'T'HH:mm:ss") : '';
}
const todayStr = () => fmt(new Date(), 'yyyy-MM-dd');
const nowStr = () => fmt(new Date(), "yyyy-MM-dd'T'HH:mm:ss");

/* ---------- Đọc ---------- */
function nextId(t, prefix) {
  let mx = 0;
  for (let r = 1; r < t.vals.length; r++) {
    const m = /^[A-Z](\d+)$/.exec(String(cellOf(t, r, 'ID')));
    if (m) mx = Math.max(mx, +m[1]);
  }
  return () => prefix + ('000000' + (++mx)).slice(-6);
}
// Dòng nhập tay (chưa có ID) -> tự cấp ID và điền mặc định
function fillMissing(t, spec, prefix, defaults) {
  const gen = nextId(t, prefix);
  for (let r = 1; r < t.vals.length; r++) {
    if (String(cellOf(t, r, 'ID')).trim() !== '') continue;
    if (String(cellOf(t, r, spec.product)).trim() === '') continue;      // dòng trống
    setCell(t, r, 'ID', gen());
    Object.keys(defaults).forEach(h => { if (String(cellOf(t, r, h)).trim() === '') setCell(t, r, h, defaults[h]); });
  }
}
function readCats() {
  const sh = book().getSheetByName(TAB.CAT);
  const res = { products: [], sizes: [], colors: [], kems: [] };
  if (!sh || sh.getLastRow() < 2) return res;
  const v = sh.getRange(2, 1, Math.min(sh.getLastRow() - 1, 100), 4).getValues();
  const col = i => v.map(r => r[i]).filter(x => String(x).trim() !== '').map(x => String(x).trim());
  res.products = col(0); res.sizes = col(1); res.colors = col(2); res.kems = col(3);
  return res;
}
function readLog(name, max) {
  const t = table(name, null, ['Thời gian', 'Vai trò', name === TAB.CMT ? 'ID đơn' : 'Đối tượng', 'Nội dung']);
  const out = [];
  for (let r = Math.max(1, t.vals.length - max); r < t.vals.length; r++) out.push(t.vals[r].slice(0, 4).map(norm));
  return out;
}
function readTabN(name, header, max) {
  const t = table(name, null, header), out = [];
  for (let r = Math.max(1, t.vals.length - max); r < t.vals.length; r++) out.push(t.vals[r].slice(0, header.length).map(norm));
  return out;
}
// Sheet tạo từ file Excel bản đầu: (1) thiếu trạng thái "Đã hủy", (2) cột Sản phẩm chặn không cho gõ tên ngoài danh sách.
// Hai việc này tự bổ sung một lần (có đánh dấu để không lặp lại); lỗi thì bỏ qua, không ảnh hưởng chạy.
function ensureSetup(o) {
  try {
    const cat = book().getSheetByName(TAB.CAT);
    if (cat && o.h[ORD.st] && String(cat.getRange('E6').getValue()).trim() === '') {
      cat.getRange('E6').setValue('Đã hủy');
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
      o.sh.getRange(2, o.h[ORD.st], 3000, 1).setDataValidation(rule);
    }
  } catch (err) { /* bỏ qua */ }
  try {
    const props = PropertiesService.getScriptProperties();
    const cat = book().getSheetByName(TAB.CAT);
    if (cat && !props.getProperty('prodWarnOnly')) {
      // vẫn có ô chọn danh sách, nhưng cho phép gõ tên sản phẩm khác (chỉ hiện cảnh báo nhỏ)
      const rule = SpreadsheetApp.newDataValidation().requireValueInRange(cat.getRange('A2:A30'), true).setAllowInvalid(true).build();
      if (o.h[ORD.product]) o.sh.getRange(2, o.h[ORD.product], 3000, 1).setDataValidation(rule);
      const st = book().getSheetByName(TAB.STK);
      if (st) { const ci = st.getRange(1, 1, 1, Math.max(st.getLastColumn(), 1)).getValues()[0].indexOf(STK.product); if (ci >= 0) st.getRange(2, ci + 1, 3000, 1).setDataValidation(rule); }
      props.setProperty('prodWarnOnly', '1');
    }
  } catch (err) { /* bỏ qua */ }
  try {
    // Bản 3: trạng thái "Đã hoàn", loại tồn "Nhập mới", tình trạng tồn "Lỗi" / "Thất thoát"
    const props = PropertiesService.getScriptProperties();
    const cat = book().getSheetByName(TAB.CAT);
    if (cat && !props.getProperty('setupV3')) {
      const put = (a1, v) => { const c = cat.getRange(a1); if (String(c.getValue()).trim() === '') c.setValue(v); };
      put('E6', 'Đã hủy'); put('E7', 'Đã hoàn'); put('G4', 'Nhập mới'); put('H4', 'Lỗi'); put('H5', 'Thất thoát');
      const list = arr => SpreadsheetApp.newDataValidation().requireValueInList(arr, true).setAllowInvalid(false).build();
      if (o.h[ORD.st]) o.sh.getRange(2, o.h[ORD.st], 3000, 1).setDataValidation(list(STATUSES));
      const st = book().getSheetByName(TAB.STK);
      if (st) {
        const hd = st.getRange(1, 1, 1, Math.max(st.getLastColumn(), 1)).getValues()[0];
        const ti = hd.indexOf(STK.type), si = hd.indexOf(STK.st);
        if (ti >= 0) st.getRange(2, ti + 1, 3000, 1).setDataValidation(list(['Hàng hoàn', 'Hàng lấy dư', 'Nhập mới']));
        if (si >= 0) st.getRange(2, si + 1, 3000, 1).setDataValidation(list(['Còn hàng', 'Đã dùng', 'Lỗi', 'Thất thoát']));
      }
      props.setProperty('setupV3', '1');
    }
  } catch (err) { /* bỏ qua */ }
}
function load(role) {
  const o = table(TAB.ORD, ORD), s = table(TAB.STK, STK);
  ensureSetup(o);
  fillMissing(o, ORD, 'D', { 'Nguồn': 'Mới', 'Trạng thái': 'Chờ đóng', 'Người tạo': 'Nhập tay trong Sheet' });
  fillMissing(s, STK, 'T', { 'Tình trạng': 'Còn hàng' });
  const orders = [], stock = [];
  for (let r = 1; r < o.vals.length; r++) if (String(cellOf(o, r, ORD.id)).trim() !== '') orders.push(rowObj(o, ORD, r));
  for (let r = 1; r < s.vals.length; r++) if (String(cellOf(s, r, STK.id)).trim() !== '') stock.push(rowObj(s, STK, r));
  return { role: role, serverTime: nowStr(), orders: orders, stock: stock, cats: readCats(), comments: readLog(TAB.CMT, 3000), log: readLog(TAB.LOG, 2000), checks: readTabN(TAB.CHK, CHK_HEADER, 400) };
}

/* ---------- Ghi ---------- */
function indexById(t) {
  const m = {};
  for (let r = 1; r < t.vals.length; r++) { const id = String(cellOf(t, r, 'ID')).trim(); if (id) m[id] = r; }
  return m;
}
// Thêm nhiều dòng cuối bảng bằng một lần ghi. rowsByHeader: [{tên cột: giá trị}]
function appendRows(t, rowsByHeader, textCols) {
  if (!rowsByHeader.length) return;
  const start = t.vals.length + 1;       // dòng sheet tiếp theo (vals đã gồm cả dòng trống ở cuối nếu có)
  const block = rowsByHeader.map(o => { const line = []; for (let c = 1; c <= t.width; c++) line.push(''); Object.keys(o).forEach(h => { if (t.h[h]) line[t.h[h] - 1] = o[h]; }); return line; });
  (textCols || []).forEach(h => { if (t.h[h]) t.sh.getRange(start, t.h[h], block.length, 1).setNumberFormat('@'); });
  t.sh.getRange(start, 1, block.length, t.width).setValues(block);
  block.forEach(l => t.vals.push(l));
}

function write(p, role) {
  const ops = p.ops || [];
  const o = table(TAB.ORD, ORD), s = table(TAB.STK, STK);
  const oIdx = indexById(o), sIdx = indexById(s);
  const newOrderId = nextId(o, 'D'), newStockId = nextId(s, 'T');
  const logRows = [], cmtRows = [], chkRows = [], results = [];
  const now = nowStr(), nowD = Utilities.parseDate(now, tz(), "yyyy-MM-dd'T'HH:mm:ss");
  const log = (target, text) => logRows.push([nowD, ROLE_NAME[role], target, String(text).slice(0, 500)]);
  const fail = msg => ({ ok: false, error: msg });

  let touched = false;
  const touch = r => { setCell(o, r, ORD.upd, nowD); touched = true; };
  const freeStockOf = (orderId) => {
    let freed = false;
    for (let r = 1; r < s.vals.length; r++) {
      if (String(cellOf(s, r, STK.forOrder)) === orderId && cellOf(s, r, STK.st) === 'Đã dùng') {
        setCell(s, r, STK.st, 'Còn hàng'); setCell(s, r, STK.used, ''); setCell(s, r, STK.forOrder, '');
        log(String(cellOf(s, r, STK.id)), 'Trả lại kho (hoàn tác đơn ' + orderId + ')');
        freed = true;
      }
    }
    if (freed && oIdx[orderId]) setCell(o, oIdx[orderId], ORD.src, 'Mới');   // không còn dùng hàng tồn nữa
  };

  ops.forEach(op => {
    try {
      if (op.t === 'order.add') {
        if (role === 'kho') return results.push(fail('Vai trò Kho không được thêm đơn'));
        const id = newOrderId();
        const row = {}; row[ORD.id] = id; row[ORD.date] = toDate(op.date) || toDate(todayStr()); row[ORD.product] = op.product;
        row[ORD.size] = +op.size || op.size; row[ORD.color] = op.color; row[ORD.code] = String(op.code || ''); row[ORD.kem] = op.kem || '';
        row[ORD.src] = 'Mới'; row[ORD.st] = 'Chờ đóng'; row[ORD.by] = ROLE_NAME[role]; row[ORD.upd] = nowD; row[ORD.note] = op.note || '';
        let res = { ok: true, id: id };
        if (op.stockId) {
          const sr = sIdx[op.stockId];
          if (sr && cellOf(s, sr, STK.st) !== 'Đã dùng') {
            row[ORD.src] = 'Hàng tồn';
            setCell(s, sr, STK.st, 'Đã dùng'); setCell(s, sr, STK.used, toDate(todayStr())); setCell(s, sr, STK.forOrder, id);
            log(op.stockId, 'Dùng cho đơn ' + id);
          } else res.stockTaken = true;       // đôi tồn đã bị người khác dùng trước
        }
        appendRows(o, [row], [ORD.code]); oIdx[id] = o.vals.length - 1;
        log(id, 'Tạo đơn' + (row[ORD.src] === 'Hàng tồn' ? ' (dùng hàng tồn)' : ''));
        return results.push(res);
      }
      if (op.t === 'order.status') {
        const r = oIdx[op.id];
        if (!r) return results.push(fail('Không thấy đơn ' + op.id));
        if (STATUSES.indexOf(op.status) < 0) return results.push(fail('Trạng thái không hợp lệ'));
        const cur = String(cellOf(o, r, ORD.st));
        if (op.from && cur !== op.from) return results.push({ ok: false, conflict: true, current: cur });
        if (op.status === 'Đã hoàn') return results.push(fail('Dùng mục "Trả hàng về" trong tab Tồn kho để nhập hàng hoàn'));
        if (cur === 'Đã hoàn') return results.push(fail('Đơn này đã hoàn về kho. Muốn nhập nhầm thì hoàn tác ở tab Tồn kho.'));
        if (role === 'shop' && ['Đã giao', 'Chờ đóng', 'Đã hủy'].indexOf(op.status) < 0) return results.push(fail('Shop không được đổi sang trạng thái này'));
        if (role === 'kho' && op.status === 'Đã hủy') return results.push(fail('Kho không được hủy đơn'));
        if (op.status === 'Đã hủy' && role !== 'chu' && cur !== 'Chờ đóng' && cur !== 'Không có hàng') return results.push(fail('Đơn đã đóng hoặc đã giao nên không hủy được. Nhờ Kho hoàn tác trước.'));
        if ((op.status === 'Chờ đóng' && cur !== 'Không có hàng') || op.status === 'Đã hủy') freeStockOf(op.id);
        setCell(o, r, ORD.st, op.status); touch(r);
        log(op.id, cur + ' → ' + op.status);
        return results.push({ ok: true });
      }
      if (op.t === 'order.edit') {
        if (role === 'kho') return results.push(fail('Vai trò Kho không được sửa đơn'));
        const r = oIdx[op.id];
        if (!r) return results.push(fail('Không thấy đơn ' + op.id));
        const cur = String(cellOf(o, r, ORD.st));
        if (cur === 'Đã giao' && role !== 'chu') return results.push(fail('Đơn đã giao, chỉ Chủ được sửa'));
        const map = { date: ORD.date, product: ORD.product, size: ORD.size, color: ORD.color, code: ORD.code, kem: ORD.kem, note: ORD.note };
        const F = op.fields || {}, changes = [];
        let itemChanged = false;
        Object.keys(F).forEach(k => {
          if (!map[k]) return;
          const old = norm(cellOf(o, r, map[k]));
          const oldS = k === 'date' ? String(old).slice(0, 10) : String(old).trim();
          const nv = String(F[k] === null || F[k] === undefined ? '' : F[k]).trim();
          if (oldS === nv) return;
          if (k === 'code') o.sh.getRange(r + 1, o.h[map[k]]).setNumberFormat('@');
          setCell(o, r, map[k], k === 'date' ? (toDate(nv) || cellOf(o, r, map[k])) : k === 'size' ? (+nv || nv) : nv);
          changes.push(map[k] + ': ' + (oldS || '(trống)') + ' → ' + (nv || '(trống)'));
          if (k === 'product' || k === 'size' || k === 'color') itemChanged = true;
        });
        if (!changes.length) return results.push({ ok: true, changed: 0 });
        const wasStock = String(cellOf(o, r, ORD.src)) === 'Hàng tồn';
        if (itemChanged && wasStock) freeStockOf(op.id);       // đổi mẫu thì đôi tồn không còn khớp, trả lại kho
        touch(r); log(op.id, 'Sửa: ' + changes.join('; '));
        return results.push({ ok: true, changed: changes.length, stockFreed: itemChanged && wasStock });
      }
      if (op.t === 'stock.add') {
        if (role === 'shop') return results.push(fail('Shop không được nhập kho'));
        const ids = [], rows = [];
        for (let i = 0; i < Math.min(+op.n || 1, 50); i++) {
          const id = newStockId(); ids.push(id);
          const row = {}; row[STK.id] = id; row[STK.date] = toDate(op.date) || toDate(todayStr()); row[STK.type] = op.type === 'du' ? 'Hàng lấy dư' : 'Hàng hoàn';
          row[STK.product] = op.product; row[STK.size] = +op.size || op.size; row[STK.color] = op.color; row[STK.ref] = String(op.ref || ''); row[STK.st] = 'Còn hàng';
          rows.push(row);
        }
        appendRows(s, rows, [STK.ref]); ids.forEach(id => { sIdx[id] = s.vals.length - ids.length + ids.indexOf(id); });
        log(ids[0], 'Nhập ' + ids.length + ' đôi ' + op.product + ' ' + op.size + ' ' + op.color);
        return results.push({ ok: true, ids: ids });
      }
      if (op.t === 'stock.use' || op.t === 'stock.free') {
        const r = sIdx[op.id];
        if (!r) return results.push(fail('Không thấy dòng tồn ' + op.id));
        if (op.t === 'stock.use') {
          if (cellOf(s, r, STK.st) === 'Đã dùng') return results.push({ ok: false, conflict: true });
          setCell(s, r, STK.st, 'Đã dùng'); setCell(s, r, STK.used, toDate(todayStr()));
          log(op.id, 'Đánh dấu đã dùng');
        } else {
          setCell(s, r, STK.st, 'Còn hàng'); setCell(s, r, STK.used, ''); setCell(s, r, STK.forOrder, '');
          log(op.id, 'Hoàn tác, trả lại kho');
        }
        return results.push({ ok: true });
      }
      if (op.t === 'stock.addGrid') {
        if (role === 'shop') return results.push(fail('Shop không được nhập kho'));
        const rows = [], ids = [];
        (op.items || []).forEach(it => {
          const k = Math.min(Math.max(+it.n || 0, 0), 100);
          for (let i = 0; i < k && ids.length < 300; i++) {
            const id = newStockId(); ids.push(id);
            const row = {}; row[STK.id] = id; row[STK.date] = toDate(op.date) || toDate(todayStr()); row[STK.type] = 'Nhập mới';
            row[STK.product] = op.product; row[STK.size] = +it.size || it.size; row[STK.color] = op.color; row[STK.ref] = ''; row[STK.st] = 'Còn hàng'; row[STK.note] = op.note || '';
            rows.push(row);
          }
        });
        if (!rows.length) return results.push(fail('Chưa nhập số lượng nào'));
        appendRows(s, rows, [STK.ref]); ids.forEach((id, i) => { sIdx[id] = s.vals.length - ids.length + i; });
        log(ids[0], 'Nhập hàng mới ' + ids.length + ' đôi ' + op.product + ' ' + op.color + (op.note ? ' (' + op.note + ')' : ''));
        return results.push({ ok: true, count: ids.length });
      }
      if (op.t === 'return.add') {
        if (role === 'shop') return results.push(fail('Shop không được nhập hàng hoàn'));
        const r = oIdx[op.orderId];
        if (!r) return results.push(fail('Không thấy đơn ' + op.orderId));
        const cur = String(cellOf(o, r, ORD.st));
        if (cur !== 'Đã giao' && cur !== 'Đã đóng') return results.push(fail('Đơn này đang ở trạng thái "' + cur + '", chưa thể nhập hàng hoàn'));
        const bad = op.cond === 'loi';
        setCell(o, r, ORD.st, 'Đã hoàn'); touch(r);
        const id = newStockId();
        const row = {}; row[STK.id] = id; row[STK.date] = toDate(todayStr()); row[STK.type] = 'Hàng hoàn';
        row[STK.product] = cellOf(o, r, ORD.product); row[STK.size] = cellOf(o, r, ORD.size); row[STK.color] = cellOf(o, r, ORD.color);
        row[STK.ref] = String(cellOf(o, r, ORD.code) || ''); row[STK.st] = bad ? 'Lỗi' : 'Còn hàng';
        row[STK.note] = 'Hoàn từ đơn ' + op.orderId + (bad ? ' (lỗi)' : '');
        appendRows(s, [row], [STK.ref]); sIdx[id] = s.vals.length - 1;
        log(op.orderId, cur + ' → Đã hoàn'); log(id, 'Nhập hàng hoàn từ đơn ' + op.orderId + (bad ? ' (lỗi)' : ''));
        return results.push({ ok: true, id: id });
      }
      if (op.t === 'return.undo') {
        if (role === 'shop') return results.push(fail('Shop không được hoàn tác nhập hoàn'));
        const sr = sIdx[op.id];
        if (!sr) return results.push(fail('Không thấy dòng tồn ' + op.id));
        const m = /Hoàn từ đơn (D\d+)/.exec(String(cellOf(s, sr, STK.note)));
        const st = String(cellOf(s, sr, STK.st));
        if (!m) return results.push(fail('Dòng này không phải hàng hoàn nhập từ mã đơn'));
        if (st !== 'Còn hàng' && st !== 'Lỗi') return results.push(fail('Đôi này đã được dùng hoặc xử lý, không hoàn tác được'));
        const r2 = oIdx[m[1]];
        if (r2 && String(cellOf(o, r2, ORD.st)) === 'Đã hoàn') { setCell(o, r2, ORD.st, 'Đã giao'); touch(r2); log(m[1], 'Đã hoàn → Đã giao (hoàn tác nhập hoàn)'); }
        setCell(s, sr, STK.st, 'Thất thoát'); setCell(s, sr, STK.note, String(cellOf(s, sr, STK.note)) + ' | Nhập nhầm, đã hoàn tác');
        log(op.id, 'Hoàn tác nhập hoàn');
        return results.push({ ok: true });
      }
      if (op.t === 'stocktake.save') {
        if (role === 'shop') return results.push(fail('Shop không được kiểm kho'));
        const dstr = fmt(nowD, 'dd/MM');
        let counted = 0, off = 0, bookAll = 0, net = 0;
        const add = [];
        for (let r = 1; r < s.vals.length; r++) if (String(cellOf(s, r, STK.id)).trim() !== '' && cellOf(s, r, STK.st) === 'Còn hàng') bookAll++;
        (op.rows || []).forEach(x => {
          const actual = Math.floor(+x.actual);
          if (!(actual >= 0)) return;
          const sz = String(x.size).trim(), pr = String(x.product).trim().toLowerCase(), cl = String(x.color).trim().toLowerCase();
          const avail = [];
          for (let r = 1; r < s.vals.length; r++) {
            if (cellOf(s, r, STK.st) !== 'Còn hàng') continue;
            if (String(cellOf(s, r, STK.product)).trim().toLowerCase() === pr && String(cellOf(s, r, STK.size)).trim() === sz && String(cellOf(s, r, STK.color)).trim().toLowerCase() === cl) avail.push(r);
          }
          avail.sort((a, b) => String(norm(cellOf(s, a, STK.date))).localeCompare(String(norm(cellOf(s, b, STK.date)))));
          const bk = avail.length, diff = actual - bk;
          let action = 'Khớp'; counted++;
          if (diff < 0) {
            avail.slice(0, -diff).forEach(r => { setCell(s, r, STK.st, 'Thất thoát'); const old = String(cellOf(s, r, STK.note)); setCell(s, r, STK.note, (old ? old + ' | ' : '') + 'Kiểm kho ' + dstr + ': thiếu'); });
            action = 'Thiếu ' + (-diff) + ' đôi → đánh dấu Thất thoát'; off++;
          } else if (diff > 0) {
            for (let i = 0; i < Math.min(diff, 100); i++) {
              const id = newStockId(), row = {};
              row[STK.id] = id; row[STK.date] = toDate(todayStr()); row[STK.type] = 'Nhập mới'; row[STK.product] = x.product; row[STK.size] = +sz || sz; row[STK.color] = x.color; row[STK.ref] = ''; row[STK.st] = 'Còn hàng'; row[STK.note] = 'Thêm từ kiểm kho ' + dstr;
              add.push(row);
            }
            action = 'Thừa ' + diff + ' đôi → thêm vào kho'; off++;
          }
          net += diff;
          chkRows.push([nowD, ROLE_NAME[role], x.product, +sz || sz, x.color, bk, actual, diff, action]);
        });
        if (add.length) appendRows(s, add, [STK.ref]);
        chkRows.push([nowD, ROLE_NAME[role], '(Chốt kiểm kho)', '', '', bookAll, '', net, 'Đã kiểm ' + counted + ' mẫu, lệch ' + off + ' mẫu']);
        log('KIEMKHO', 'Chốt kiểm kho: đã kiểm ' + counted + ' mẫu, lệch ' + off + ' mẫu');
        return results.push({ ok: true, counted: counted, off: off });
      }
      if (op.t === 'comment') {
        if (!oIdx[op.orderId]) return results.push(fail('Không thấy đơn'));
        cmtRows.push([nowD, ROLE_NAME[role], op.orderId, String(op.text || '').slice(0, 2000)]);
        return results.push({ ok: true });
      }
      results.push(fail('Thao tác không hợp lệ'));
    } catch (err) { results.push(fail(String(err && err.message || err))); }
  });

  const appendTab = (name, header, rows) => {
    if (!rows.length) return;
    const t = table(name, null, header), start = t.vals.length + 1;
    t.sh.getRange(start, 1, rows.length, 4).setValues(rows);
    t.sh.getRange(start, 1, rows.length, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  };
  if (touched) o.sh.getRange(2, o.h[ORD.upd], Math.max(o.vals.length - 1, 1), 1).setNumberFormat('dd/mm/yyyy hh:mm');
  if (chkRows.length) {
    const t = table(TAB.CHK, null, CHK_HEADER), start = t.vals.length + 1;
    t.sh.getRange(start, 1, chkRows.length, CHK_HEADER.length).setValues(chkRows);
    t.sh.getRange(start, 1, chkRows.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  }
  appendTab(TAB.CMT, ['Thời gian', 'Vai trò', 'ID đơn', 'Nội dung'], cmtRows);
  appendTab(TAB.LOG, ['Thời gian', 'Vai trò', 'Đối tượng', 'Nội dung'], logRows);
  SpreadsheetApp.flush();
  return { results: results };
}

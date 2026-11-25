'use strict';
/* Giao diện (GitHub Pages) <-> Apps Script <-> Google Sheet (các tab Đơn hàng, Tồn kho, Danh mục…).
   Mỗi dòng trong tab "Đơn hàng" là một đôi. Các dòng cùng Mã đơn được gom thành một KIỆN (đơn nhiều đôi).
   Trang này không lưu dữ liệu nào ngoài mật khẩu của người dùng trên máy họ. */

/* ===== Hằng số ===== */
let PRODUCTS = ['Nagaki Karyu', 'Nagaki Kakashi', 'Nagaki Katashi', 'Nagaki Nekketsu', 'Kizuma'];
let SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'];
let BASE_COLORS = ['xanh rêu', 'xanh ngọc', 'trắng đỏ', 'trắng', 'xanh đen', 'xanh bích', 'vàng', 'navy', 'đen', 'trắng đồng', 'cam'];
let KEMS = ['', 'bó gối', 'tất'];
const ST = { moi: 'Chờ đóng', da_dong: 'Đã đóng', da_giao: 'Đã giao', khong_co: 'Không có hàng', hoan: 'Đã hoàn', huy: 'Đã hủy' };
const ST_TO_CODE = Object.fromEntries(Object.entries(ST).map(([k, v]) => [v, k]));
const ROLES = { shop: 'Shop', kho: 'Kho', chu: 'Chủ' };
const TABS = [['orders', 'Đơn hàng'], ['pack', 'Cần đóng'], ['stock', 'Tồn kho'], ['dash', 'Tổng quan'], ['close', 'Chốt tháng']];
const API = (window.APP_CONFIG || {}).api;

/* ===== Tiện ích ===== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toLocaleDateString('sv');
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const fmtD = d => d ? d.slice(8) + '/' + d.slice(5, 7) : '';
const normColor = s => (s || '').toLowerCase().replace(/[']/g, '').replace(/\s+/g, ' ').trim();
const key = x => [x.product, x.size, x.color].join('|');
const lineText = x => `${x.product} · ${x.size} · ${cap(x.color)}`;
function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 3200); }
function setSync(t, bad) { const e = $('#sync'); e.textContent = t; e.style.color = bad ? 'var(--bad)' : ''; $('#usermenu').classList.toggle('bad', !!bad); }

/* ===== Dữ liệu ===== */
let S = { orders: [], stock: [], comments: [], log: [], groups: [] };
let role = null, PW = '';
try { PW = localStorage.getItem('tts-pw') || ''; } catch { /* bỏ qua */ }
let tab = 'orders';
try { tab = localStorage.getItem('tts-tab') || 'orders'; } catch { /* bỏ qua */ }
const F = { date: '', st: '', q: '', stockView: 'con', stockQ: '', month: '' };
const TICKS = new Set();   // món đã tick khi nhặt hàng (chỉ trên màn hình, không lưu)

async function api(action, x = {}) {
  if (!API) throw new Error('Chưa cấu hình link Apps Script (config.js)');
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ pw: PW, action, ...x }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
const mapOrders = arr => (arr || []).map(o => ({
    id: o.id, date: String(o.date).slice(0, 10), product: o.product, size: String(o.size), color: normColor(o.color), code: String(o.code || '').trim(),
    kem: String(o.kem || '').trim(), note: String(o.note || '').trim(), fromStock: o.src === 'Hàng tồn', status: ST_TO_CODE[o.st] || 'moi', notes: o.note ? [String(o.note)] : [],
  })).filter(o => o.product);
const mapStock = arr => (arr || []).map(x => ({
    id: x.id, date: String(x.date).slice(0, 10), type: x.type === 'Hàng lấy dư' ? 'du' : x.type === 'Nhập mới' ? 'moi' : 'hoan', product: x.product, size: String(x.size), color: normColor(x.color),
    ref: String(x.ref || ''), state: x.st === 'Đã dùng' ? 'used' : x.st === 'Lỗi' ? 'loi' : x.st === 'Thất thoát' ? 'mat' : 'con', used: x.st === 'Đã dùng',
    usedDate: String(x.used || '').slice(0, 10), usedBy: String(x.forOrder || ''), note: String(x.note || '').trim(),
  })).filter(x => x.product);
// Dữ liệu lần tải gần nhất được giữ trên máy để lần sau mở app hiện ngay (xoá khi đăng xuất)
const CACHE_KEY = 'tts-cache';
let LAST = null;
function saveCache(d) { LAST = d; try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { /* bỏ qua: đầy bộ nhớ thì thôi */ } }
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } }
const typing = () => { const ae = document.activeElement; return !!(ae && ae.closest && ae.closest('#main') && /INPUT|TEXTAREA/.test(ae.tagName)); };
function build(d) {
  const lc = x => String(x || '').toLowerCase().trim();
  const c = d.cats || {};
  if (c.products && c.products.length) PRODUCTS = c.products;
  if (c.sizes && c.sizes.length) SIZES = c.sizes.map(String);
  if (c.colors && c.colors.length) BASE_COLORS = c.colors.map(normColor);
  if (c.kems && c.kems.length) KEMS = ['', ...c.kems.map(lc)];
  S.orders = mapOrders(d.orders);
  S.stock = mapStock(d.stock);
  S.rev = d.rev || null;
  S.comments = d.comments.map(([ts, who, k, text]) => ({ ts: Date.parse(ts) || 0, who, key: String(k), text }));
  S.log = d.log.map(([ts, who, k, text]) => ({ ts: Date.parse(ts) || 0, who, key: String(k), text }));
  S.pricing = d.pricing || null;
  S.closes = (d.closes || []).map(([m, who, ts, pairs, shop, partner, margin]) => ({ month: String(m), who, ts: Date.parse(ts) || 0, pairs: +pairs || 0, shop: +shop || 0, partner: +partner || 0, margin: +margin || 0 }));
  S.checks = (d.checks || []).map(([ts, who, p, sz, c, book, act, diff, action]) => ({ ts: Date.parse(ts) || 0, who, p: String(p), sz: String(sz), c: String(c), book, act, diff, action: String(action || '') }));
}
// Gom các dòng cùng Mã đơn thành kiện. Dòng chưa có mã thì tự là một kiện riêng.
function buildGroups() {
  const m = new Map();
  S.orders.forEach(o => { const k = o.code ? 'c' + o.code : 'i' + o.id; if (!m.has(k)) m.set(k, []); m.get(k).push(o); });
  S.groups = [...m.values()].map(items => {
    items.sort((a, b) => a.id.localeCompare(b.id));
    const act = items.filter(i => i.status !== 'huy');
    const g = { id: items[0].id, code: items[0].code, date: items.map(i => i.date).sort()[0], items, active: act };
    const live = act.filter(i => i.status !== 'hoan');      // đôi đã hoàn về kho không tính vào trạng thái chung
    g.status = !act.length ? 'huy' : !live.length ? 'hoan' : live.every(i => i.status === live[0].status) ? live[0].status
      : live.some(i => i.status === 'khong_co') ? 'khong_co' : live.some(i => i.status === 'moi') ? 'moi' : 'da_dong';
        return g;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
const groupOf = id => S.groups.find(g => g.id === id);
const kemText = g => { const m = {}; g.active.forEach(i => { if (i.kem) m[i.kem] = (m[i.kem] || 0) + 1; }); return Object.entries(m).map(([k, n]) => n > 1 ? `${n}× ${k}` : k).join(', '); };

let busy = 0, chain = Promise.resolve();
// Ghi lên sheet lần lượt (không chạy song song), xong thì tải lại dữ liệu mới nhất.
function save(ops) {
  busy++; setSync('Đang lưu…');
  let fresh = false;
  chain = chain.then(() => api('write', { ops })).then(r => {
    if (r.orders && r.stock) {
      S.orders = mapOrders(r.orders); S.stock = mapStock(r.stock); S.rev = r.rev || S.rev;
      if (LAST) { LAST.orders = r.orders; LAST.stock = r.stock; LAST.rev = r.rev; saveCache(LAST); }
      fresh = !ops.some(o => /^(comment|pricing\.save|month\.close|stocktake\.save)$/.test(o.t));
    }
    const rs = r.results || [];
    if (rs.some(x => x.stockTaken)) toast('Đôi tồn đã có người dùng trước nên đơn được tạo như hàng mới.');
    else if (rs.some(x => x.conflict)) toast('Có đơn vừa được người khác thay đổi. Đã tải lại dữ liệu mới nhất.');
    else { const bad = rs.find(x => x.error); if (bad) toast(bad.error); else if (rs.some(x => x.stockFreed)) toast('Đã đổi mẫu nên đôi tồn được trả lại kho.'); }
  }).catch(e => toast(e.message)).then(async () => {
    busy--;
    if (busy) return;
    if (fresh) { setSync('Đã lưu ' + new Date().toLocaleTimeString('vi-VN')); if (!typing()) render(); }
    else await refresh(true);
  });
  return chain;
}
async function refresh(force) {
  if (busy && !force) return;
  try {
    const d = await api('load'); build(d); saveCache(d);
    setSync('Đã đồng bộ ' + new Date().toLocaleTimeString('vi-VN'));
    if (!typing()) render();
  } catch (e) {
    if (/mật khẩu/i.test(e.message)) logout('Mật khẩu đã đổi, hãy đăng nhập lại.');
    else setSync('Mất kết nối – ' + e.message, true);
  }
}

/* ===== Đăng nhập ===== */
function showLogin(msg) { $('#login').hidden = false; $('#login-err').textContent = msg || ''; $('#pw').focus(); }
function logout(msg) {
  try { localStorage.removeItem('tts-pw'); localStorage.removeItem(CACHE_KEY); } catch { /* bỏ qua */ }
  LAST = null; PW = ''; role = null; S = { orders: [], stock: [], comments: [], log: [], groups: [] };
  $('#main').innerHTML = ''; $('#tabs').innerHTML = ''; $('#me').textContent = ''; $('#logout').hidden = true; $('#usermenu').hidden = true; setSync('');
  showLogin(msg);
}
function showApp(keepFilters) {
  $('#login').hidden = true; $('#me').textContent = ROLES[role]; $('#logout').hidden = false; $('#usermenu').hidden = false;
  if (!keepFilters) {
    const dates = S.orders.map(o => o.date).sort();
    F.date = S.orders.some(o => o.date === today()) ? today() : (dates[dates.length - 1] || '');
    F.month = (dates[dates.length - 1] || today()).slice(0, 7);
  }
  render();
}
async function enter(fromCache) {
  setSync(fromCache ? 'Đang cập nhật…' : 'Đang tải…');
  const d = await api('load');
  if (!d.role) throw new Error('Không đọc được vai trò');
  role = d.role; build(d); saveCache(d);
  try { localStorage.setItem('tts-pw', PW); } catch { /* bỏ qua */ }
  setSync('Đã đồng bộ ' + new Date().toLocaleTimeString('vi-VN'));
  if (fromCache) { if (!typing() && $('#modal').hidden) render(); return; }
  showApp();
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  PW = $('#pw').value; $('#login-err').textContent = 'Đang kiểm tra…';
  try { await enter(); $('#pw').value = ''; $('#login-err').textContent = ''; } catch (err) { PW = ''; $('#login-err').textContent = err.message; }
});
$('#logout').onclick = () => logout();

/* ===== Nghiệp vụ ===== */
const can = (...r) => r.includes(role) || role === 'chu';
const availStock = () => S.stock.filter(s => s.state === 'con');
const matches = o => availStock().filter(s => key(s) === key(o));
const colorList = () => [...new Set([...BASE_COLORS, ...S.orders.map(o => o.color), ...S.stock.map(s => s.color)].filter(Boolean))];

// Đổi trạng thái một dòng: cập nhật ngay trên màn hình, server làm phần còn lại (trả tồn, nhật ký…)
function changeStatus(o, st, ops) {
  ops.push({ t: 'order.status', id: o.id, status: ST[st], from: ST[o.status] });
  if ((st === 'moi' && o.status !== 'khong_co') || st === 'huy') {
    S.stock.filter(x => x.usedBy === o.id && x.used).forEach(x => { x.used = false; x.state = 'con'; x.usedDate = ''; x.usedBy = ''; });
    o.fromStock = false;
  }
  o.status = st;
}
const has = (g, ...st) => g.items.some(i => st.includes(i.status));
// Thao tác lên cả kiện: mỗi dòng chỉ đổi nếu đang ở trạng thái phù hợp
function groupAction(g, act) {
  const ops = [], mv = (st, ...from) => g.items.filter(i => from.includes(i.status)).forEach(i => changeStatus(i, st, ops));
  if (act === 'close') mv('da_dong', 'moi');
  else if (act === 'unavail') mv('khong_co', 'moi');
  else if (act === 'deliver') mv('da_giao', 'da_dong');
  else if (act === 'undo') { if (has(g, 'da_giao')) mv('da_dong', 'da_giao'); else mv('moi', 'da_dong'); }
  else if (act === 'reopen') mv('moi', 'khong_co', 'huy');
  else if (act === 'cancel') mv('huy', 'moi', 'khong_co', ...(role === 'chu' ? ['da_dong', 'da_giao'] : []));
  if (!ops.length) return toast('Không có gì để đổi');
  save(ops); render();
}
function groupButtons(g) {
  const n = g.items.filter(i => i.status === 'moi').length, b = [];
  const add = (act, t, c = '') => b.push(`<button class="btn sm ${c}" data-a="g:${act}" data-g="${g.id}">${t}</button>`);
  if (can('kho') && has(g, 'moi')) { add('close', n > 1 ? `Đã đóng cả kiện (${n})` : 'Đã đóng', 'ok'); add('unavail', 'Không có hàng', 'bad'); }
  if (can('kho', 'shop') && has(g, 'da_dong')) add('deliver', 'Đã giao', 'ok');
  if (can('kho') && has(g, 'da_dong', 'da_giao')) add('undo', 'Hoàn tác');
  if (can('shop') && has(g, 'khong_co', 'huy')) add('reopen', 'Mở lại');
  if (can('shop') && (has(g, 'moi', 'khong_co') || (role === 'chu' && has(g, 'da_dong', 'da_giao')))) add('cancel', 'Hủy', 'bad');
  return b.join('');
}

/* ===== Giao diện chung ===== */
function render() {
  if (!role) return;
  buildGroups();
  if (tab === 'close' && role !== 'chu') tab = 'orders';
  $('#tabs').innerHTML = TABS.filter(([k]) => k !== 'close' || role === 'chu').map(([k, t]) => {
    const n = k === 'pack' ? S.groups.filter(g => has(g, 'moi')).length : 0;
    return `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${t}${n ? ` (${n})` : ''}</button>`;
  }).join('');
  ({ orders: vOrders, pack: vPack, stock: vStock, dash: vDash, close: vClose }[tab] || vOrders)();
}
const badge = s => `<span class="badge b-${s}">${ST[s]}</span>`;
const opts = (arr, sel) => arr.map(v => `<option ${String(v) === String(sel) ? 'selected' : ''}>${esc(v)}</option>`).join('');
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="mbox">${html}</div>`; m.hidden = false; }
function closeModal() { $('#modal').hidden = true; NG = RET = CK = null; render(); }
const itemTags = i => `${i.kem ? `<span class="tag">${esc(i.kem)}</span>` : ''}${i.fromStock ? '<span class="tag stock">hàng tồn</span>' : ''}`;

/* ===== Đơn hàng (theo kiện) ===== */
function filteredGroups() {
  const q = F.q.toLowerCase();
  return S.groups.filter(g => (!F.date || g.date === F.date) && (!F.st || g.status === F.st) &&
    (!q || g.items.some(o => (o.code + ' ' + o.product + ' ' + o.color + ' ' + o.size).toLowerCase().includes(q))));
}
function ordRow(g) {
  const nc = g.items.reduce((c, i) => c + S.comments.filter(x => x.key === i.id).length + i.notes.length, 0);
  const miss = g.active.filter(i => i.status === 'khong_co').length, hn = g.active.filter(i => i.status === 'hoan').length;
  const canEdit = can('shop') && (g.status !== 'da_giao' || role === 'chu');
  return `<div class="ord"><div class="o-meta"><span class="o-date">${fmtD(g.date)}</span><span class="code">${esc(g.code) || '<span class="mut">—</span>'}</span>${g.active.length > 1 ? `<span class="tag">${g.active.length} đôi</span>` : ''}</div>
    <div class="o-items">${g.items.map(i => `<div class="ln${i.status === 'huy' ? ' cancelled' : ''}">${esc(lineText(i))} ${itemTags(i)}${g.items.length > 1 && i.status !== g.status && i.status !== 'huy' ? ` <span class="mut">(${ST[i.status]})</span>` : ''}${i.status === 'huy' && g.items.length > 1 ? ' <span class="mut">(đã hủy)</span>' : ''}${i.note ? `<div class="mut note-ln">📝 ${esc(i.note)}</div>` : ''}</div>`).join('')}
      ${kemText(g) && g.active.length > 1 ? `<div class="mut">Kèm cả đơn: ${esc(kemText(g))}</div>` : ''}</div>
    <div class="o-st">${badge(g.status)}${miss && g.status === 'khong_co' && g.active.length > 1 ? `<div class="mut">${miss}/${g.active.length} đôi hết hàng</div>` : ''}${hn && g.status !== 'hoan' ? `<div class="mut">${hn} đôi đã hoàn</div>` : ''}</div>
    <div class="o-acts">${groupButtons(g)}<button class="btn sm ic" data-a="cm" data-g="${g.id}" title="Trao đổi">💬${nc ? ' ' + nc : ''}</button>${canEdit ? `<button class="btn sm ic" data-a="edit" data-g="${g.id}" title="Sửa đơn">✎</button>` : ''}</div></div>`;
}
function vOrders() {
  const dates = [...new Set(S.groups.map(g => g.date))].sort().reverse();
  const base = S.groups.filter(g => !F.date || g.date === F.date);
  const cnt = st => base.filter(g => g.status === st).length;
  const rows = filteredGroups();
  const chips = [['', 'Tất cả', base.length], ...Object.keys(ST).map(k => [k, ST[k], cnt(k)])].filter(([k, , c]) => k === '' || c > 0 || F.st === k);
  $('#main').innerHTML = `
  <div class="bar">
    <select data-f="date"><option value="">Tất cả ngày</option>${dates.map(d => `<option value="${d}" ${d === F.date ? 'selected' : ''}>${fmtD(d)}/${d.slice(0, 4)}</option>`).join('')}</select>
    <input data-f="q" class="grow" placeholder="Tìm mã đơn, sản phẩm, màu…" value="${esc(F.q)}">
    ${can('shop') ? '<button class="btn pri" data-a="new">+ Thêm đơn</button>' : ''}
    <details class="more"><summary class="btn ic" aria-label="Thêm tuỳ chọn">⋯</summary><div class="menu">${can('shop') ? '<button data-a="bulk">Dán nhiều đơn</button>' : ''}<button data-a="csv">Xuất CSV</button><button data-a="reload">Tải lại dữ liệu</button></div></details>
  </div>
  <div class="chips">${chips.map(([k, t, c]) => `<span class="chip ${F.st === k ? 'on' : ''}" data-st="${k}">${t} ${c}</span>`).join('')}</div>
  <div class="list">${rows.slice(0, 300).map(ordRow).join('') || '<div class="empty">Không có đơn nào.</div>'}</div>${rows.length > 300 ? `<p class="mut">Đang hiện 300/${rows.length} đơn – hãy lọc theo ngày.</p>` : ''}`;
}

/* ===== Thêm đơn (nhiều đôi) ===== */
let ADD = null;
const newLine = (p = {}) => ({ product: PRODUCTS[0], size: '40', color: '', kem: '', note: '', qty: 1, src: 'new', stockIds: [], autoPick: false, custom: false, ...p });
// Sản phẩm: chọn trong danh sách (chủ yếu) hoặc "Khác" để gõ tên tự do. a = tên thuộc tính data-k / data-e
const isCustomProd = l => l.custom || (l.product && !PRODUCTS.includes(l.product));
const prodHtml = (l, a) => { const c = isCustomProd(l); return `<select ${a}="productSel">${opts(PRODUCTS, c ? '' : l.product)}<option value="__other__" ${c ? 'selected' : ''}>Khác (gõ tên)…</option></select>`; };
const prodOther = (l, a) => isCustomProd(l) ? `<input ${a}="product" class="wide" value="${esc(l.product)}" placeholder="Tên sản phẩm gõ tay (ví dụ: tất, bó gối, mẫu mới…)">` : '';
const sizeList = () => `<datalist id="dl-size">${SIZES.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
const canon = nm => PRODUCTS.find(p => p.toLowerCase() === String(nm).trim().toLowerCase()) || String(nm).trim();
const kemList = () => `<datalist id="dl-kem">${KEMS.filter(Boolean).map(k => `<option value="${esc(k)}">`).join('')}</datalist>`;
function lineHtml(l, i) {
  return `<div class="aline" data-i="${i}">
    ${prodHtml(l, 'data-k')}
    <input data-k="size" list="dl-size" value="${esc(l.size)}" placeholder="size">
    <input data-k="color" list="dl-color" value="${esc(l.color)}" placeholder="màu">
    <input data-k="kem" list="dl-kem" value="${esc(l.kem)}" placeholder="đóng kèm (tuỳ ý)">
    <input data-k="qty" type="number" min="1" max="20" value="${l.qty}" title="Số đôi giống nhau">
    ${ADD.lines.length > 1 ? `<button class="btn sm bad" data-a="al-del" data-i="${i}" title="Bỏ dòng này">✕</button>` : '<span></span>'}
    ${prodOther(l, 'data-k')}
    ${l.note || l.showNote ? `<input data-k="note" class="wide" value="${esc(l.note)}" placeholder="Ghi chú cho đôi này">` : ''}
    <div class="srcrow wide"><span class="mut">Nguồn:</span>
      <label><input type="radio" name="src-${i}" value="new" ${l.src === 'new' ? 'checked' : ''}> Hàng mới</label>
      <label><input type="radio" name="src-${i}" value="stock" ${l.src === 'stock' ? 'checked' : ''}> Dùng tồn <span class="tag stock" id="sc-${i}"></span></label>${l.note || l.showNote ? '' : `<button type="button" class="linkbtn" data-a="al-note" data-i="${i}">+ ghi chú</button>`}</div>
    <div class="sugg-line" id="sg-${i}"></div></div>`;
}
function newOrderModal(pre = {}) {
  ADD = { date: pre.date || today(), code: pre.code || '', lines: [newLine(pre.line || {})], extra: !!pre.code };
  const kemHint = 'Đóng kèm viết tự do, ví dụ: 2 tất đen + 1 bó gối';
  modal(`<h3>${pre.code ? 'Thêm đôi vào đơn ' + esc(pre.code) : 'Thêm đơn'}</h3>
  <div class="fld"><label>Ngày</label><input type="date" id="a-date" value="${ADD.date}"></div>
  <div class="fld"><label>Mã đơn</label><input id="a-code" inputmode="numeric" value="${esc(ADD.code)}" placeholder="vd: 802123456789 (các đôi trong cùng đơn dùng chung mã)"></div>
  ${pre.code ? '' : '<div class="fld"><label>Ghi chú đơn</label><input id="a-note" placeholder="Ghi chú chung cho cả đơn (tuỳ chọn)"></div>'}
  <div class="mut" style="margin:10px 0 4px">Hàng trong đơn</div>
  <datalist id="dl-color">${colorList().map(c => `<option value="${esc(c)}">`).join('')}</datalist>${kemList()}${sizeList()}
  <div id="alines"></div>
  <div class="mut" style="font-size:12px;margin-top:4px">${kemHint}.</div>
  <button class="btn sm" data-a="al-add" style="margin-top:6px">+ thêm đôi</button>
  <div id="a-sum" class="sum"></div>
  <div class="row"><button class="btn" data-a="close">Huỷ</button><button class="btn pri" data-a="save-order">Lưu đơn</button></div>`);
  drawLines();
}
function drawLines() { $('#alines').innerHTML = ADD.lines.map(lineHtml).join(''); ADD.lines.forEach((_, i) => updSug(i)); }
// Đôi tồn đúng mẫu của dòng i (trừ những đôi đã chọn ở dòng khác)
function availFor(i) {
  const l = ADD.lines[i]; if (!normColor(l.color)) return [];
  const taken = new Set(ADD.lines.flatMap((x, j) => j !== i ? x.stockIds : []));
  return matches({ product: canon(l.product), size: String(l.size).trim(), color: normColor(l.color) }).filter(s => !taken.has(s.id));
}
function updSug(i) {
  const l = ADD.lines[i], el = $('#sg-' + i), sc = $('#sc-' + i); if (!el) return;
  const av = availFor(i);
  if (sc) sc.textContent = normColor(l.color) ? 'kho có ' + av.length : '';
  l.stockIds = l.stockIds.filter(id => av.some(s => s.id === id)).slice(0, l.qty);
  if (l.src === 'stock') {
    if (l.autoPick) { l.stockIds = av.slice(0, l.qty).map(s => s.id); l.autoPick = false; }
    el.innerHTML = !normColor(l.color) ? '<div class="mut">Chọn màu trước để xem kho có đôi nào.</div>'
      : av.length ? `<div class="sugg"><b>Chọn đôi lấy từ kho</b> (tối đa ${l.qty} đôi). Đôi được chọn sẽ được <b>đánh dấu "Đã dùng"</b> và trừ khỏi kho khi lưu đơn.
        ${av.map(s => `<label><input type="checkbox" data-stk="${s.id}" ${l.stockIds.includes(s.id) ? 'checked' : ''}> ${s.type === 'hoan' ? 'Hàng hoàn' : 'Hàng lấy dư'} ${fmtD(s.date)}${s.ref ? ' · ' + esc(s.ref) : ''}</label>`).join('')}
        <div class="mut" style="margin-top:4px">${l.stockIds.length}/${l.qty} đôi lấy từ tồn${l.qty > l.stockIds.length ? ' · ' + (l.qty - l.stockIds.length) + ' đôi còn lại lấy hàng mới' : ''}</div></div>`
      : '<div class="warn">Kho không có tồn đúng mẫu này, các đôi sẽ được lấy hàng mới.</div>';
  } else el.innerHTML = '';
  updSum();
}
function updSum() {
  const el = $('#a-sum'); if (!el) return;
  const tot = ADD.lines.reduce((n, l) => n + l.qty, 0), st = ADD.lines.reduce((n, l) => n + (l.src === 'stock' ? Math.min(l.stockIds.length, l.qty) : 0), 0);
  el.innerHTML = `Tổng <b>${tot}</b> đôi: <b>${st}</b> đôi dùng hàng tồn (trừ khỏi kho), <b>${tot - st}</b> đôi lấy hàng mới.`;
}
// Thêm nhiều dòng trong một lần ghi. items: [{d, stock}]
function addOrders(items) {
  const ops = items.map(({ d, stock }) => {
    if (stock) { stock.used = true; stock.state = 'used'; stock.usedDate = today(); }
    return { t: 'order.add', date: d.date || today(), product: d.product, size: d.size, color: cap(normColor(d.color)), code: d.code || '', kem: String(d.kem || '').trim(), note: String(d.note || '').trim(), stockId: stock ? stock.id : undefined };
  });
  return save(ops);
}
function saveOrder() {
  const date = $('#a-date').value, code = $('#a-code').value.replace(/\D/g, '');
  if (ADD.lines.some(l => !String(l.product).trim())) return toast('Dòng nào cũng cần có tên sản phẩm');
  if (ADD.lines.some(l => !String(l.size).trim())) return toast('Dòng nào cũng cần có size');
  if (ADD.lines.some(l => !normColor(l.color))) return toast('Dòng nào cũng cần chọn màu');
  if (code && !ADD.extra && S.orders.some(o => o.code === code) && !confirm('Mã đơn này đã có trong sheet. Vẫn thêm các đôi này vào đơn đó?')) return;
  const items = [], onote = ($('#a-note') ? $('#a-note').value.trim() : '');
  ADD.lines.forEach((l, li) => {
    const n = Math.max(1, Math.min(+l.qty || 1, 20));
    const ids = l.src === 'stock' ? l.stockIds.slice(0, n) : [];
    for (let k = 0; k < n; k++) items.push({ d: { date, code, product: canon(l.product), size: String(l.size).trim(), color: l.color, kem: l.kem, note: (li === 0 && k === 0 ? [onote, l.note] : [l.note]).filter(Boolean).join(' | ') }, stock: ids[k] ? S.stock.find(s => s.id === ids[k]) : null });
  });
  const used = items.filter(i => i.stock).length;
  addOrders(items);
  closeModal(); toast(`Đang thêm ${items.length} đôi vào Google Sheet${used ? ` (trừ ${used} đôi khỏi kho tồn)` : ''}…`);
}

/* ===== Dán nhiều đơn ===== */
function parseLine(line) {
  let note = '', kemFree = '';
  const nm = line.match(/(?:ghi chú|note)\s*[:\-]?\s*(.+)$/i); if (nm) { note = nm[1].trim(); line = line.slice(0, nm.index); }
  const km = line.match(/\bkèm\s*[:\-]?\s*(.+)$/i); if (km) { kemFree = km[1].trim(); line = line.slice(0, km.index); }
  let t = line.toLowerCase(), code = '', qty = 1;
  const cm = t.match(/\b\d{9,14}\b/); if (cm) { code = cm[0]; t = t.replace(code, ' '); }
  const qm = t.match(/(?:^|\s)[x×]\s?(\d{1,2})\b|\b(\d{1,2})\s?(?:đôi|doi)\b/); if (qm) { qty = +(qm[1] || qm[2]) || 1; t = t.replace(qm[0], ' '); }
  const sm = t.match(/\b(3[5-9]|4[0-6])\b/);
  const pm = [['karyu', 'Nagaki Karyu'], ['kakashi', 'Nagaki Kakashi'], ['katashi|takashi', 'Nagaki Katashi'], ['netketsu|nekketsu', 'Nagaki Nekketsu'], ['kizuma', 'Kizuma']].find(([r]) => new RegExp(r).test(t));
  const color = colorList().sort((a, b) => b.length - a.length).find(c => t.includes(c)) || '';
  return { product: pm && pm[1], size: sm && sm[1], color, code, qty, note, kem: kemFree || (/bó gối/.test(t) ? 'bó gối' : /\btất\b/.test(t) ? 'tất' : '') };
}
function bulkModal() {
  modal(`<h3>Dán nhiều đơn</h3><p class="mut">Mỗi dòng một đôi. Các dòng cùng mã đơn sẽ thành một đơn nhiều đôi. Thêm <span class="code">x2</span> hoặc <span class="code">2 đôi</span> nếu có nhiều đôi giống nhau.<br>Ví dụ: <span class="code">nagaki karyu 42 xanh ngọc 802123456789 x2 kèm 2 tất đen ghi chú giao giờ hành chính</span><br>Sau chữ <b>kèm</b> là đồ đóng kèm, sau <b>ghi chú</b> là ghi chú (viết tự do).</p>
  <textarea id="bulk" rows="9" placeholder="Dán danh sách đơn ở đây…"></textarea>
  <label style="display:block;margin:8px 0"><input type="checkbox" id="bulk-auto"> Tự dùng hàng tồn nếu kho có đúng mẫu (đôi đó sẽ được <b>đánh dấu Đã dùng</b> và trừ khỏi kho). Không tích thì tất cả lấy hàng mới.</label><div id="bulk-res" class="mut"></div>
  <div class="row"><button class="btn" data-a="close">Huỷ</button><button class="btn pri" data-a="bulk-save">Thêm các dòng hợp lệ</button></div>`);
  $('#bulk').oninput = () => {
    const ls = $('#bulk').value.split('\n').filter(l => l.trim()).map(parseLine);
    const ok = ls.filter(x => x.product && x.size && x.color);
    $('#bulk-res').textContent = `${ok.length} dòng hợp lệ (${ok.reduce((n, x) => n + x.qty, 0)} đôi)${ls.length - ok.length ? ` · ${ls.length - ok.length} dòng thiếu sản phẩm/size/màu (sẽ bỏ qua)` : ''}`;
  };
}
function bulkSave() {
  const ls = $('#bulk').value.split('\n').filter(l => l.trim()).map(parseLine).filter(x => x.product && x.size && x.color);
  const have = new Set(S.orders.map(o => o.code).filter(Boolean)); let skip = 0; const items = [], auto = $('#bulk-auto') && $('#bulk-auto').checked, taken = new Set();
  ls.forEach(x => {
    if (x.code && have.has(x.code)) { skip++; return; }      // mã đã có trong sheet thì bỏ qua (dán lại lần nữa)
    for (let k = 0; k < x.qty; k++) {
      const st = auto ? matches({ product: x.product, size: x.size, color: normColor(x.color) }).find(s => !taken.has(s.id)) : null;
      if (st) taken.add(st.id);
      items.push({ d: x, stock: st || null });
    }
  });
  const used = items.filter(i => i.stock).length;
  if (items.length) addOrders(items);
  closeModal(); toast(`Đang thêm ${items.length} đôi${used ? `, trừ ${used} đôi khỏi kho tồn` : ''}${skip ? `, bỏ qua ${skip} dòng có mã đã tồn tại` : ''}…`);
}

/* ===== Sửa đơn ===== */
let EDIT = null;
function eLineHtml(l, i) {
  return `<div class="aline${l.status === 'huy' ? ' cancelled' : ''}" data-i="${i}">
    ${prodHtml(l, 'data-e')}<input data-e="size" list="dl-size" value="${esc(l.size)}" placeholder="size">
    <input data-e="color" list="dl-color" value="${esc(l.color)}"><input data-e="kem" list="dl-kem" value="${esc(l.kem)}" placeholder="đóng kèm">
    <span>${badge(l.status)}</span>
    ${l.status === 'huy' ? `<button class="btn sm" data-a="e-reopen" data-i="${i}">Mở lại</button>` : (l.status === 'moi' || l.status === 'khong_co' || role === 'chu') ? `<button class="btn sm bad" data-a="e-cancel" data-i="${i}">Hủy đôi này</button>` : '<span></span>'}
    ${prodOther(l, 'data-e')}
    <input data-e="note" class="wide" value="${esc(l.note)}" placeholder="Ghi chú cho đôi này"></div>`;
}
function editModal(gid) {
  const g = groupOf(gid); if (!g) return;
  EDIT = { gid, code: g.code, date: g.date, lines: g.items.map(i => ({ id: i.id, product: i.product, size: i.size, color: i.color, kem: i.kem, note: i.note || '', status: i.status, orig: { product: i.product, size: i.size, color: i.color, kem: i.kem, note: i.note || '' } })) };
  modal(`<h3>Sửa đơn ${esc(g.code) || '(chưa có mã)'}</h3>
  <div class="fld"><label>Ngày</label><input type="date" id="e-date" value="${g.date}"></div>
  <div class="fld"><label>Mã đơn</label><input id="e-code" inputmode="numeric" value="${esc(g.code)}"></div>
  <datalist id="dl-color">${colorList().map(c => `<option value="${esc(c)}">`).join('')}</datalist>${kemList()}${sizeList()}
  <div class="mut" style="margin:10px 0 4px">Hàng trong đơn:</div>
  <div id="elines">${EDIT.lines.map(eLineHtml).join('')}</div>
  <button class="btn sm" data-a="e-more" style="margin-top:6px">+ thêm đôi vào đơn này</button>
  <div class="row"><button class="btn" data-a="close">Đóng</button><button class="btn pri" data-a="e-save">Lưu thay đổi</button></div>`);
}
function saveEdit() {
  const code = $('#e-code').value.replace(/\D/g, ''), date = $('#e-date').value, g = groupOf(EDIT.gid), ops = [];
  EDIT.lines.forEach(l => {
    const f = {};
    if (code !== g.code) f.code = code;
    if (date !== g.date) f.date = date;
    if (canon(l.product) !== l.orig.product) f.product = canon(l.product);
    if (String(l.size).trim() !== String(l.orig.size)) f.size = String(l.size).trim();
    if (String(l.kem || '').trim() !== l.orig.kem) f.kem = String(l.kem || '').trim();
    if (String(l.note || '').trim() !== l.orig.note) f.note = String(l.note || '').trim();
    if (normColor(l.color) !== l.orig.color) f.color = cap(normColor(l.color));
    if (Object.keys(f).length) ops.push({ t: 'order.edit', id: l.id, fields: f });
  });
  if (!ops.length) return closeModal();
  if (EDIT.lines.some(l => !normColor(l.color))) return toast('Dòng nào cũng cần có màu');
  if (EDIT.lines.some(l => !String(l.product).trim() || !String(l.size).trim())) return toast('Dòng nào cũng cần có sản phẩm và size');
  save(ops); closeModal(); toast('Đang lưu thay đổi…');
}

/* ===== Bình luận ===== */
const QUICK = ['Không có hàng', 'Đã đóng rồi', 'Khách đổi size', 'Dùng hàng tồn', 'Đã giao rồi'];
function commentModal(gid) {
  const g = groupOf(gid); if (!g) return;
  const ids = new Set(g.items.map(i => i.id));
  const cs = S.comments.filter(c => ids.has(c.key)).sort((a, b) => a.ts - b.ts);
  const lg = S.log.filter(c => ids.has(c.key)).sort((a, b) => a.ts - b.ts);
  const notes = g.items.flatMap(i => i.notes);
  modal(`<h3>Đơn ${esc(g.code) || '(chưa có mã)'}</h3><div class="mut">${fmtD(g.date)} · ${ST[g.status]}</div>
  <div style="margin:6px 0">${g.items.map(i => `<div class="ln">${esc(lineText(i))} ${itemTags(i)}</div>`).join('')}</div>
  <div style="margin:10px 0">
  ${notes.map(n => `<div class="cm"><small>Ghi chú trong Google Sheet</small><br>${esc(n)}</div>`).join('')}
  ${cs.map(c => `<div class="cm"><small>${esc(ROLES[c.who] || c.who)} · ${new Date(c.ts).toLocaleString('vi-VN')}</small><br>${esc(c.text)}</div>`).join('')}
  ${cs.length || notes.length ? '' : '<p class="mut">Chưa có trao đổi nào.</p>'}
  </div>
  ${lg.length ? `<details style="margin-bottom:8px"><summary class="mut">Lịch sử thay đổi (${lg.length})</summary><div class="mut" style="font-size:13px">${lg.map(l => `${new Date(l.ts).toLocaleString('vi-VN')} · ${esc(ROLES[l.who] || l.who)}: ${esc(l.text)}`).join('<br>')}</div></details>` : ''}
  <div class="chips" style="margin-bottom:8px">${QUICK.map(q => `<span class="chip" data-quick="${esc(q)}">${q}</span>`).join('')}</div>
  <textarea id="cm-text" rows="2" placeholder="Nhắn cho người còn lại…"></textarea>
  <div class="row"><button class="btn" data-a="close">Đóng</button><button class="btn pri" data-a="cm-send" data-g="${gid}">Gửi</button></div>`);
}

/* ===== Cần đóng (màn hình của Kho, theo kiện) ===== */
function vPack() {
  const gs = S.groups.filter(g => has(g, 'moi')).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const lines = gs.flatMap(g => g.items.filter(i => i.status === 'moi'));
  const pick = {}; lines.forEach(i => pick[key(i)] = (pick[key(i)] || 0) + 1);
  const kem = lines.reduce((m, i) => (i.kem && (m[i.kem] = (m[i.kem] || 0) + 1), m), {});
  $('#main').innerHTML = `<div class="grid">
    <div class="stat"><b>${gs.length}</b><span>đơn chờ đóng</span></div>
    <div class="stat"><b>${lines.length}</b><span>đôi cần lấy</span></div>
    <div class="stat"><b>${lines.filter(i => i.kem).length}</b><span>đôi có đồ kèm</span></div></div>
  ${lines.length ? `<details class="card"><summary><b>Tổng hợp cần lấy hàng</b> <span class="mut">(${Object.keys(pick).length} mẫu)</span></summary>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${Object.entries(pick).sort().map(([k, n]) => { const [p, s, c] = k.split('|'); return `<span class="tag">${esc(p)} · ${s} · ${esc(cap(c))} <b>× ${n}</b></span>`; }).join('')}</div>
    ${Object.keys(kem).length ? `<div class="mut" style="margin-top:10px">Đồ đóng kèm cần chuẩn bị: ${Object.entries(kem).map(([k, c]) => `<b>${c}</b> ${esc(k)}`).join(' · ')}</div>` : ''}</details>` : ''}
  ${gs.length ? '' : '<div class="card">🎉 Không còn đơn nào chờ đóng.</div>'}
  ${gs.map(g => {
    const todo = g.items.filter(i => i.status === 'moi' || i.status === 'khong_co');
    return `<div class="card kien"><div class="kh"><b class="code">${esc(g.code) || '(chưa có mã)'}</b> <span class="mut">${fmtD(g.date)}</span>
      ${g.active.length > 1 ? `<span class="tag">${g.active.length} đôi</span>` : ''}${kemText(g) ? `<span class="tag">kèm: ${esc(kemText(g))}</span>` : ''}</div>
      ${todo.map(i => `<div class="ln pk"><label>${i.status === 'moi' ? `<input type="checkbox" data-tick="${i.id}" ${TICKS.has(i.id) ? 'checked' : ''}> ` : ''}<span class="${i.status === 'khong_co' ? 'cancelled' : ''}">${esc(lineText(i))}</span> ${itemTags(i)}${i.status === 'khong_co' ? ' <span class="badge b-khong_co">hết hàng</span>' : ''}${i.note ? `<div class="mut note-ln">📝 ${esc(i.note)}</div>` : ''}</label>
        ${can('kho') ? (i.status === 'moi' ? `<button class="btn sm bad" data-a="line:khong_co" data-id="${i.id}">Hết hàng</button>` : `<button class="btn sm" data-a="line:moi" data-id="${i.id}">Có hàng lại</button>`) : ''}</div>`).join('')}
      <div class="acts" style="margin-top:8px;justify-content:flex-start">${groupButtons(g)}<button class="btn sm" data-a="cm" data-g="${g.id}">💬</button></div></div>`;
  }).join('')}`;
}

/* ===== Tồn kho ===== */
const TYPE_TXT = { hoan: 'Hàng hoàn', du: 'Hàng lấy dư', moi: 'Nhập mới' };
function stockBadge(s) {
  if (s.state === 'used') { const o = s.usedBy && S.orders.find(x => x.id === s.usedBy); return `<span class="badge b-da_dong">Đã dùng ${fmtD(s.usedDate)}${o ? ' · ' + esc(o.code || 'đơn mới') : ''}</span>`; }
  if (s.state === 'loi') return '<span class="badge b-khong_co">Lỗi</span>';
  if (s.state === 'mat') return '<span class="badge b-huy">Thất thoát</span>';
  return '<span class="badge b-da_giao">Còn hàng</span>';
}
const lastCheck = () => (S.checks || []).filter(c => c.p === '(Chốt kiểm kho)').sort((a, b) => b.ts - a.ts)[0] || null;
function vStock() {
  const av = availStock(), q = F.stockQ.toLowerCase(), view = F.stockView;
  const piv = {}; av.forEach(s => piv[key(s)] = (piv[key(s)] || 0) + 1);
  const n = st => S.stock.filter(s => s.state === st).length;
  const rows = S.stock.filter(s => (view === 'all' || (view === 'con' && s.state === 'con') || (view === 'used' && s.state === 'used') || (view === 'khac' && (s.state === 'loi' || s.state === 'mat')))
    && (!q || lineText(s).toLowerCase().includes(q) || (s.ref || '').includes(q) || (s.note || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  const lc = lastCheck(), thisMonth = lc && new Date(lc.ts).toLocaleDateString('sv').slice(0, 7) === today().slice(0, 7);
  const remind = can('kho') && !thisMonth && new Date().getDate() >= 25;
  const lastBatch = lc ? (S.checks || []).filter(c => Math.abs(c.ts - lc.ts) < 5000 && c.p !== '(Chốt kiểm kho)' && +c.diff !== 0) : [];
  $('#main').innerHTML = `${remind ? '<div class="warn">📋 Sắp hết tháng mà chưa kiểm kho tháng này. <button class="btn sm" data-a="check-open">Kiểm kho ngay</button></div>' : ''}
  <div class="bar">
    <input data-f="stockQ" class="grow" placeholder="Tìm mẫu, màu, mã hoàn…" value="${esc(F.stockQ)}">
    ${can('kho') ? '<button class="btn pri" data-a="return-open">↩ Trả hàng về</button><button class="btn pri" data-a="new-goods">+ Nhập hàng mới</button>' : ''}
    ${can('kho') ? '<details class="more"><summary class="btn ic" aria-label="Thêm tuỳ chọn">⋯</summary><div class="menu"><button data-a="check-open">☑ Kiểm kho</button></div></details>' : ''}</div>
  <div class="chips">${[['con', 'Còn hàng ' + av.length], ['used', 'Đã dùng lại ' + n('used')], ['khac', 'Lỗi / thất thoát ' + (n('loi') + n('mat'))], ['all', 'Tất cả']].map(([k, t]) => `<span class="chip ${view === k ? 'on' : ''}" data-sv="${k}">${t}</span>`).join('')}</div>
  <details class="card" id="stock-info" ${(F.stockInfoOpen ?? innerWidth > 640) ? 'open' : ''}><summary><b>Tồn hiện có theo mẫu</b> <span class="mut">(${Object.keys(piv).length} mẫu · ${av.length} đôi)</span></summary><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
    ${Object.entries(piv).sort().map(([k, c]) => { const [p, sz, cl] = k.split('|'); return `<span class="tag stock">${esc(p)} · ${esc(sz)} · ${esc(cap(cl))} × ${c}</span>`; }).join('') || '<span class="mut">Kho trống</span>'}</div>
    ${lc ? `<div class="mut" style="margin-top:8px">Lần kiểm kho gần nhất: ${new Date(lc.ts).toLocaleDateString('vi-VN')} · ${esc(lc.who)} · ${esc(lc.action)}</div>` : '<div class="mut" style="margin-top:8px">Chưa có lần kiểm kho nào.</div>'}
    ${lastBatch.length ? `<details style="margin-top:6px"><summary class="mut">Mẫu lệch ở lần kiểm gần nhất (${lastBatch.length})</summary><div class="mut code">${lastBatch.map(c => esc(`${c.p} · ${c.sz} · ${c.c}: sổ ${c.book} → thực tế ${c.act} (${c.diff > 0 ? '+' : ''}${c.diff})`)).join('<br>')}</div></details>` : ''}</details>
  <div class="list">${rows.slice(0, 400).map(s => {
    const undo = can('kho') && /Hoàn từ đơn D\d+/.test(s.note) && (s.state === 'con' || s.state === 'loi');
    return `<div class="ord stk"><div class="o-meta"><span class="o-date">${fmtD(s.date)}</span><span class="mut">${TYPE_TXT[s.type]}</span></div>
      <div class="o-items"><div class="ln">${esc(lineText(s))}</div>${s.ref ? `<div class="mut code">${esc(s.ref)}</div>` : ''}${s.note ? `<div class="mut note-ln">${esc(s.note)}</div>` : ''}</div>
      <div class="o-st">${stockBadge(s)}</div>
      <div class="o-acts">${can('kho', 'shop') ? (s.state === 'used' ? `<button class="btn sm" data-a="stock-free" data-id="${s.id}">Hoàn tác</button>` : s.state === 'con' ? `<button class="btn sm" data-a="stock-use" data-id="${s.id}">Đánh dấu đã dùng</button>` : '') : ''}${undo ? `<button class="btn sm bad" data-a="ret-undo" data-id="${s.id}" title="Nhập nhầm: bỏ dòng hoàn này và trả đơn về Đã giao">Hoàn tác nhập</button>` : ''}</div></div>`; }).join('') || '<div class="empty">Không có dòng nào.</div>'}</div>${rows.length > 400 ? `<p class="mut">Đang hiện 400/${rows.length} dòng – hãy lọc hoặc tìm kiếm.</p>` : ''}`;
}

/* --- Nhập hàng mới (lưới size) --- */
let NG = null;
function ngProdDraw() { $('#ng-prod').innerHTML = prodHtml(NG, 'data-ng') + prodOther(NG, 'data-ng'); }
function ngItems() {
  const it = [...document.querySelectorAll('[data-ngs]')].map(i => ({ size: i.dataset.ngs, n: Math.floor(+i.value) || 0 })).filter(x => x.n > 0);
  const o = { size: ($('[data-ngo=size]').value || '').trim(), n: Math.floor(+$('[data-ngo=n]').value) || 0 };
  if (o.size && o.n > 0) it.push(o);
  return it;
}
function ngSum() { const t = ngItems().reduce((a, x) => a + x.n, 0); $('#ng-sum').innerHTML = `Tổng <b>${t}</b> đôi sẽ được thêm vào kho (tình trạng Còn hàng).`; }
function newGoodsModal() {
  NG = { product: PRODUCTS[0], custom: false };
  modal(`<h3>Nhập hàng mới</h3>
  <div class="fld"><label>Ngày</label><input type="date" id="ng-date" value="${today()}"></div>
  <div class="fld"><label>Sản phẩm</label><div id="ng-prod" class="stackf"></div></div>
  <div class="fld"><label>Màu</label><input id="ng-color" list="dl-color" placeholder="chọn hoặc gõ"></div>
  <div class="fld"><label>Nguồn / ghi chú</label><input id="ng-note" placeholder="vd: nhập từ Thể Thao Net (tuỳ chọn)"></div>
  <datalist id="dl-color">${colorList().map(c => `<option value="${esc(c)}">`).join('')}</datalist>${sizeList()}
  <div class="mut" style="margin:8px 0 4px">Số đôi theo size (để trống = 0):</div>
  <div class="sizegrid">${SIZES.map(sz => `<label class="sz"><span>${esc(sz)}</span><input type="number" min="0" max="100" data-ngs="${esc(sz)}"></label>`).join('')}
    <label class="sz wide2"><span>Size khác</span><div class="two"><input data-ngo="size" list="dl-size" placeholder="size"><input type="number" min="0" max="100" data-ngo="n" placeholder="số đôi"></div></label></div>
  <div id="ng-sum" class="sum"></div>
  <div class="row"><button class="btn" data-a="close">Huỷ</button><button class="btn pri" data-a="ng-save">Lưu vào kho</button></div>`);
  ngProdDraw(); ngSum();
}
function ngSave() {
  const color = normColor($('#ng-color').value), prod = canon(NG.product), items = ngItems();
  if (!prod) return toast('Chọn hoặc gõ tên sản phẩm');
  if (!color) return toast('Chọn màu trước nhé');
  if (!items.length) return toast('Nhập số đôi ở ít nhất một size');
  const total = items.reduce((a, x) => a + x.n, 0);
  save([{ t: 'stock.addGrid', date: $('#ng-date').value || today(), product: prod, color: cap(color), note: $('#ng-note').value.trim(), items }]);
  closeModal(); toast(`Đang nhập ${total} đôi vào kho…`);
}

/* --- Trả hàng về (nhập theo mã đơn) --- */
let RET = null;
const retEligible = o => o.status === 'da_giao' || o.status === 'da_dong';
function returnModal() {
  RET = { items: [], missing: [] };
  modal(`<h3>Trả hàng về</h3>
  <p class="mut">Nhập hoặc quét <b>mã đơn hàng trả về</b> rồi nhấn Enter. Có thể dán nhiều mã (mỗi mã một dòng). App tự điền mẫu, size, màu từ đơn.</p>
  <textarea id="rt-code" rows="2" inputmode="numeric" placeholder="Mã đơn hoàn…"></textarea>
  <div class="row" style="justify-content:flex-start;margin:6px 0"><button class="btn sm" data-a="rt-add">Thêm mã</button><button class="btn sm" data-a="rt-manual">Không có mã đơn? Nhập tay</button></div>
  <div id="rt-list"></div>
  <div class="row"><button class="btn" data-a="close">Huỷ</button><button class="btn pri" data-a="rt-save">Lưu hàng hoàn</button></div>`);
  $('#rt-code').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); rtAdd(); } });
  $('#rt-code').focus(); rtDraw();
}
function rtAdd() {
  const el = $('#rt-code'), txt = el.value; el.value = '';
  const codes = [...new Set(txt.match(/\d{9,14}/g) || (txt.trim() ? txt.trim().split(/\s+/) : []))];
  let dup = 0;
  codes.forEach(code => {
    const lines = S.orders.filter(o => o.code === code);
    if (!lines.length) { if (!RET.missing.includes(code)) RET.missing.push(code); return; }
    lines.forEach(o => { if (RET.items.some(x => x.id === o.id)) dup++; else RET.items.push({ id: o.id, code, cond: 'tot', on: retEligible(o) }); });
  });
  if (dup && codes.length === 1) toast('Mã này đã có trong danh sách');
  rtDraw(); el.focus();
}
function rtDraw() {
  const groups = {}; RET.items.forEach(x => (groups[x.code] = groups[x.code] || []).push(x));
  $('#rt-list').innerHTML = Object.entries(groups).map(([code, xs]) => `<div class="card kien"><div class="kh"><b class="code">${esc(code)}</b><span class="sp" style="flex:1"></span><button class="btn sm" data-a="rt-del" data-code="${esc(code)}">Bỏ mã này</button></div>
    ${xs.map(x => { const o = S.orders.find(y => y.id === x.id), ok = retEligible(o);
      return `<div class="ln pk"><label><input type="checkbox" data-rt="on" data-id="${x.id}" ${x.on ? 'checked' : ''} ${ok ? '' : 'disabled'}> ${esc(lineText(o))} ${itemTags(o)}</label>
        ${ok ? `<select data-rt="cond" data-id="${x.id}"><option value="tot" ${x.cond === 'tot' ? 'selected' : ''}>Tốt</option><option value="loi" ${x.cond === 'loi' ? 'selected' : ''}>Lỗi</option></select>` : `<span class="mut">${esc(ST[o.status])}: chưa thể nhập hoàn</span>`}</div>`; }).join('')}</div>`).join('')
    + RET.missing.map(c => `<div class="warn">Không thấy mã <b>${esc(c)}</b> trong đơn hàng. <button class="btn sm" data-a="rt-manual" data-code="${esc(c)}">Nhập tay</button></div>`).join('');
  const k = RET.items.filter(x => x.on).length, sv = document.querySelector('[data-a=rt-save]');
  if (sv) sv.textContent = k ? `Lưu hàng hoàn (${k} đôi)` : 'Lưu hàng hoàn';
}
function rtSave() {
  const sel = RET.items.filter(x => x.on);
  if (!sel.length) return toast('Chưa chọn đôi nào để nhập hoàn');
  const ops = sel.map(x => ({ t: 'return.add', orderId: x.id, cond: x.cond }));
  sel.forEach(x => { const o = S.orders.find(y => y.id === x.id); if (o) o.status = 'hoan'; });
  save(ops); closeModal(); toast(`Đang nhập ${sel.length} đôi hàng hoàn…`);
}

/* --- Kiểm kho hàng tháng --- */
let CK = null;
function ckRows() {
  return CK.rows.map((r, i) => `<tr data-ck="r${i}" data-q="${esc((r.product + ' ' + r.size + ' ' + r.color).toLowerCase())}"><td>${esc(lineText(r))}</td><td>${r.book}</td>
    <td><input type="number" min="0" data-ckv="r${i}" value="${esc(r.actual)}" class="ckin"></td><td class="mut" id="ckd-r${i}"></td></tr>`).join('')
    + CK.extra.map((r, i) => `<tr data-ck="x${i}"><td><div class="two"><input data-ckx="product" data-i="${i}" list="dl-prod" value="${esc(r.product)}" placeholder="sản phẩm"><input data-ckx="size" data-i="${i}" list="dl-size" value="${esc(r.size)}" placeholder="size" style="max-width:70px"><input data-ckx="color" data-i="${i}" list="dl-color" value="${esc(r.color)}" placeholder="màu"></div></td><td>0</td>
    <td><input type="number" min="0" data-ckv="x${i}" value="${esc(r.actual)}" class="ckin"></td><td class="mut" id="ckd-x${i}"></td></tr>`).join('');
}
function ckSum() {
  let counted = 0, lack = 0, over = 0;
  const upd = (r, id) => { const el = document.getElementById('ckd-' + id); const has = String(r.actual).trim() !== ''; if (has) counted++; const d = has ? (+r.actual) - r.book : 0; if (d < 0) lack -= d; if (d > 0) over += d; if (el) el.textContent = !has ? '' : d === 0 ? '✔ khớp' : (d > 0 ? '+' : '') + d + (d > 0 ? ' thừa' : ' thiếu'); };
  CK.rows.forEach((r, i) => upd(r, 'r' + i)); CK.extra.forEach((r, i) => upd(r, 'x' + i));
  $('#ck-sum').innerHTML = counted ? `Đã đếm <b>${counted}</b> mẫu: thiếu <b>${lack}</b> đôi (đánh dấu Thất thoát), thừa <b>${over}</b> đôi (thêm vào kho).` : 'Chưa nhập mẫu nào. Mẫu để trống sẽ không thay đổi.';
}
function checkModal() {
  const piv = {}; availStock().forEach(s => piv[key(s)] = (piv[key(s)] || 0) + 1);
  CK = { rows: Object.entries(piv).sort().map(([k, c]) => { const [p, sz, cl] = k.split('|'); return { product: p, size: sz, color: cl, book: c, actual: '' }; }), extra: [] };
  modal(`<h3>Kiểm tồn kho</h3>
  <p class="mut">Cột <b>Sổ sách</b> là số đôi app đang ghi. Chỉ cần gõ <b>số đếm thực tế</b> ở mẫu bạn đã đếm, mẫu để trống thì không đổi. Thiếu sẽ đánh dấu <b>Thất thoát</b>, thừa sẽ thêm vào kho.</p>
  <input id="ck-q" placeholder="Lọc mẫu…" style="width:100%;margin-bottom:8px">
  <datalist id="dl-color">${colorList().map(c => `<option value="${esc(c)}">`).join('')}</datalist>${sizeList()}<datalist id="dl-prod">${PRODUCTS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
  <div class="wrap" style="max-height:46vh;overflow:auto"><table class="tbl"><thead><tr><th>Mẫu</th><th>Sổ sách</th><th>Thực tế</th><th></th></tr></thead><tbody id="ck-body"></tbody></table></div>
  <button class="btn sm" data-a="ck-extra" style="margin-top:6px">+ Thêm mẫu có trong kho nhưng chưa ghi sổ</button>
  <div id="ck-sum" class="sum"></div>
  <div class="row"><button class="btn" data-a="close">Huỷ</button><button class="btn pri" data-a="ck-save">Chốt kiểm kho</button></div>`);
  $('#ck-body').innerHTML = ckRows(); ckSum();
}
function ckSave() {
  const all = [...CK.rows, ...CK.extra].filter(r => String(r.actual).trim() !== '');
  if (all.some(r => !String(r.product).trim() || !String(r.size).trim() || !normColor(r.color))) return toast('Mẫu thêm tay cần đủ sản phẩm, size và màu');
  let lack = 0, over = 0; all.forEach(r => { const d = (+r.actual) - r.book; if (d < 0) lack -= d; if (d > 0) over += d; });
  const msg = all.length ? `Chốt kiểm kho: ${all.length} mẫu đã đếm (thiếu ${lack} đôi → Thất thoát, thừa ${over} đôi → thêm vào kho)?` : 'Chưa nhập mẫu nào. Ghi nhận "đã kiểm kho, tất cả khớp sổ sách"?';
  if (!confirm(msg)) return;
  save([{ t: 'stocktake.save', rows: all.map(r => ({ product: canon(r.product), size: String(r.size).trim(), color: cap(normColor(r.color)), actual: Math.floor(+r.actual) })) }]);
  closeModal(); toast('Đang chốt kiểm kho…');
}

/* --- Nhập tay (không có mã đơn) --- */
function newStockModal(pre = {}) {
  modal(`<h3>Nhập tay hàng hoàn / lấy dư</h3>
  <div class="fld"><label>Loại</label><select id="s-type"><option value="hoan">Hàng hoàn</option><option value="du">Hàng lấy dư</option></select></div>
  <div class="fld"><label>Sản phẩm</label><select id="s-product">${opts(PRODUCTS)}</select></div>
  <div class="fld"><label>Size</label><select id="s-size">${opts(SIZES, '40')}</select></div>
  <div class="fld"><label>Màu</label><input id="s-color" list="dl-c2"><datalist id="dl-c2">${colorList().map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
  <div class="fld"><label>Mã đơn hoàn</label><input id="s-ref" value="${esc(pre.ref || '')}" placeholder="(nếu có)"></div>
  <div class="fld"><label>Số lượng</label><input id="s-n" type="number" min="1" value="1"></div>
  <div class="row"><button class="btn" data-a="close">Huỷ</button><button class="btn pri" data-a="stock-save">Lưu</button></div>`);
}
function saveStock() {
  const color = normColor($('#s-color').value); if (!color) return toast('Chọn màu trước nhé');
  const n = Math.min(+$('#s-n').value || 1, 50), type = $('#s-type').value;
  save([{ t: 'stock.add', date: today(), type, product: $('#s-product').value, size: $('#s-size').value, color: cap(color), ref: $('#s-ref').value.trim(), n }]);
  closeModal(); toast(`Đang nhập ${n} đôi vào kho…`);
}

/* ===== Tổng quan ===== */
function bars(map) {
  const e = Object.entries(map).sort((a, b) => b[1] - a[1]), mx = e[0] ? e[0][1] : 1;
  return `<div class="bars">${e.map(([k, v]) => `<div class="r"><span class="l">${esc(cap(k))}</span><span class="t"><i style="width:${v / mx * 100}%"></i></span><b>${v}</b></div>`).join('')}</div>`;
}
function vDash() {
  const months = [...new Set(S.groups.map(g => g.date.slice(0, 7)))].sort().reverse();
  const G = S.groups.filter(g => g.date.startsWith(F.month)), live = G.filter(g => g.status !== 'huy');
  const L = live.flatMap(g => g.active);
  const by = f => L.reduce((m, o) => (m[f(o)] = (m[f(o)] || 0) + 1, m), {});
  const c = s => G.filter(g => g.status === s).length;
  const fromStock = L.filter(o => o.fromStock).length;
  const hoanN = L.filter(o => o.status === 'hoan').length, delivered = L.filter(o => o.status === 'da_giao' || o.status === 'hoan').length, hoanRate = delivered ? (hoanN / delivered * 100).toFixed(1).replace(/.0$/, '').replace('.', ',') : 0;
  const stale = S.groups.filter(g => (g.status === 'moi' || g.status === 'khong_co') && g.date < today());
  const noCode = live.filter(g => !g.code).length;
  $('#main').innerHTML = `<div class="bar"><select data-f="month">${months.map(m => `<option value="${m}" ${m === F.month ? 'selected' : ''}>Tháng ${m.slice(5)}/${m.slice(0, 4)}</option>`).join('')}</select><span class="sp"></span>
    <span class="mut">Dữ liệu lấy trực tiếp từ Google Sheet</span></div>
  <div class="grid">
    <div class="stat"><b>${live.length}</b><span>đơn (${L.length} đôi)</span></div>
    <div class="stat"><b>${c('da_giao')}</b><span>đã giao</span></div>
    <div class="stat"><b>${c('moi') + c('da_dong')}</b><span>chưa giao xong</span></div>
    <div class="stat"><b>${c('khong_co')}</b><span>không có hàng</span></div>
    <div class="stat"><b>${c('huy')}</b><span>đã hủy</span></div>
    <div class="stat"><b>${hoanN}</b><span>đôi đã hoàn (${hoanRate}% số đôi đã giao)</span></div>
    <div class="stat"><b>${L.length ? Math.round(fromStock / L.length * 100) : 0}%</b><span>đôi lấy từ hàng tồn</span></div>
    <div class="stat"><b>${availStock().length}</b><span>đôi còn trong kho</span></div></div>
  ${stale.length ? `<div class="warn">⚠ ${stale.length} đơn của ngày trước vẫn chưa đóng xong (Chờ đóng / Không có hàng).</div>` : ''}
  ${noCode ? `<div class="warn">⚠ ${noCode} đơn trong tháng chưa có mã đơn. Bấm ✎ ở danh sách đơn để bổ sung.</div>` : ''}
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="card"><b>Theo sản phẩm (đôi)</b>${bars(by(o => o.product))}</div>
    <div class="card"><b>Theo màu</b>${bars(by(o => o.color))}</div>
    <div class="card"><b>Theo size</b>${bars(by(o => o.size))}</div></div>`;
}

/* ===== Chốt tháng (chỉ Chủ) ===== */
const PRICING_FIELDS = [
  ['Tên trên bảng', [['shop_name', 'Shop', 'text'], ['partner_name', 'Kho / đối tác', 'text'], ['issuer', 'Người lập', 'text']]],
  ['Shop: giá mỗi đôi theo số đôi trong ngày', [['shop_t1_max', 'Mức 1: dưới (đôi)'], ['shop_t1_price', 'Giá'], ['shop_t2_max', 'Mức 2: dưới'], ['shop_t2_price', 'Giá'], ['shop_t3_max', 'Mức 3: dưới'], ['shop_t3_price', 'Giá'], ['shop_t4_max', 'Mức 4: dưới'], ['shop_t4_price', 'Giá'], ['shop_t5_price', 'Từ mức 4: giá']]],
  ['Đơn nhiều đôi', [['bulk_on', 'Tính riêng (Có/Không)', 'text'], ['bulk_min', 'Là đơn nhiều đôi khi hơn (đôi)'], ['shop_bulk_price', 'Shop: giá/đôi'], ['shop_bulk_big_min', 'Mức rất nhiều: hơn (đôi)'], ['shop_bulk_big_price', 'Shop: giá/đôi'], ['partner_bulk_price', 'Đối tác: giá/đôi']]],
  ['Khác', [['partner_price', 'Đối tác: giá/đôi (đơn thường)'], ['count_returned', 'Tính phí đôi đã hoàn (Có/Không)', 'text']]],
];
const fmtM = n => Number(n || 0).toLocaleString('vi-VN');
const monthsAvail = () => [...new Set(S.orders.map(o => o.date.slice(0, 7)))].sort().reverse();
function defaultCloseMonth() {
  const ms = monthsAvail(), d = new Date(), cur = today().slice(0, 7);
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleDateString('sv').slice(0, 7);
  return d.getDate() <= 7 && ms.includes(prev) ? prev : ms.includes(cur) ? cur : ms[0] || cur;
}
const billLines = () => S.orders.map(o => ({ id: o.id, date: o.date, status: o.status, code: o.code, product: o.product, size: o.size, color: o.color, kem: o.kem }));
const currentBill = () => Billing.computeMonth(billLines(), F.closeMonth || defaultCloseMonth(), S.pricing || {});
const latestClose = m => (S.closes || []).filter(c => c.month === m).sort((a, b) => b.ts - a.ts)[0] || null;
function vClose() {
  if (!F.closeMonth) F.closeMonth = defaultCloseMonth();
  const month = F.closeMonth, R = currentBill(), P = R.P, cl = latestClose(month), months = monthsAvail();
  const inMonth = S.orders.filter(o => o.date.startsWith(month));
  const pend = inMonth.filter(o => o.status === 'moi').length, noCode = R.rows.filter(r => !r.code).length;
  const changed = cl && (cl.shop !== R.totals.shop || cl.partner !== R.totals.partner);
  const card = (kind) => {
    const shop = kind === 'shop', amt = shop ? R.totals.shop : R.totals.partner;
    return `<div class="card bill"><div class="mut">${shop ? 'Gửi Shop' : 'Thanh toán kho / đối tác'} · <b>${esc(shop ? P.shop_name : P.partner_name)}</b></div>
      <div class="amt">${fmtM(amt)} <small>đ</small></div><div class="mut">${R.days.length} ngày · ${fmtM(R.totals.pairs)} đôi</div>
      <div class="acts" style="justify-content:flex-start;margin:10px 0"><button class="btn pri" data-a="bill" data-kind="${kind}" data-fmt="xlsx">⬇ Excel</button><button class="btn" data-a="bill" data-kind="${kind}" data-fmt="pdf">⬇ PDF</button></div>
      <details><summary class="mut">Xem theo ngày</summary><div class="wrap"><table class="tbl"><thead><tr><th>Ngày</th><th class="num">Đôi</th>${shop ? '<th class="num">Đơn giá</th>' : ''}<th class="num">Thành tiền</th></tr></thead><tbody>
      ${R.days.map(d => `<tr><td>${fmtD(d.date)}</td><td class="num">${d.pairs}</td>${shop ? `<td class="num">${d.bulk + d.bulkBig ? '…' : fmtM(d.tierPrice)}</td>` : ''}<td class="num">${fmtM(shop ? d.shopTotal : d.partnerTotal)}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">Chưa có đôi nào được đóng.</td></tr>'}
      </tbody></table></div></details></div>`;
  };
  $('#main').innerHTML = `<div class="bar"><select data-f="closeMonth">${months.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>Tháng ${m.slice(5)}/${m.slice(0, 4)}</option>`).join('')}</select>
      <span class="sp"></span><label class="mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-a="bill-list" ${F.billList === false ? '' : 'checked'}> Kèm danh sách đơn</label>
      <button class="btn pri" data-a="close-month">Chốt tháng</button></div>
    ${cl ? `<div class="${changed ? 'warn' : 'note'}">${changed ? '⚠ Số liệu hiện tại khác lúc chốt. ' : '✔ '}Đã chốt ${new Date(cl.ts).toLocaleDateString('vi-VN')} bởi ${esc(cl.who)}: Shop ${fmtM(cl.shop)}đ · đối tác ${fmtM(cl.partner)}đ${changed ? `. Hiện tại: Shop ${fmtM(R.totals.shop)}đ · đối tác ${fmtM(R.totals.partner)}đ. Bấm Chốt tháng để cập nhật.` : '.'}</div>` : ''}
    ${pend ? `<div class="warn">⚠ Còn ${pend} đôi chờ đóng trong tháng này, chưa được tính phí.</div>` : ''}${noCode ? `<div class="warn">⚠ ${noCode} đôi tính phí chưa có mã đơn.</div>` : ''}
    <div class="grid"><div class="stat"><b>${fmtM(R.totals.pairs)}</b><span>đôi tính phí</span></div><div class="stat"><b>${fmtM(R.totals.shop)}</b><span>thu từ Shop (đ)</span></div>
      <div class="stat"><b>${fmtM(R.totals.partner)}</b><span>trả đối tác (đ)</span></div><div class="stat"><b>${fmtM(R.totals.margin)}</b><span>chênh lệch (đ), chỉ Chủ thấy</span></div></div>
    <div class="grid2">${card('shop')}${card('partner')}</div>
    <details class="card" id="pr-box"><summary><b>Bảng giá</b> <span class="mut">(sửa được, lưu trong Google Sheet)</span></summary>
      ${PRICING_FIELDS.map(([t, fs]) => `<div class="mut" style="margin:12px 0 4px">${t}</div><div class="prg">${fs.map(([k, l, ty]) => `<label><span>${l}</span><input data-pr="${k}" ${ty === 'text' ? '' : 'inputmode="numeric"'} value="${esc(P[k])}"></label>`).join('')}</div>`).join('')}
      <div class="row"><button class="btn pri" data-a="pricing-save">Lưu bảng giá</button></div></details>`;
}
const loadJs = src => new Promise((res, rej) => { if (window.Export) return res(); const e = document.createElement('script'); e.src = src; e.onload = res; e.onerror = () => rej(new Error('Không tải được ' + src)); document.head.appendChild(e); });

/* ===== Xuất CSV ===== */
function exportCSV() {
  const h = ['Ngày', 'Mã đơn hàng', 'Sản phẩm', 'Size', 'Màu', 'Đóng kèm', 'Nguồn', 'Trạng thái'];
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [h, ...filteredGroups().slice().reverse().flatMap(g => g.items.map(o => [o.date, o.code, o.product, o.size, o.color, o.kem, o.fromStock ? 'Hàng tồn' : 'Mới', ST[o.status]]))].map(r => r.map(cell).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'don-hang.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ===== Sự kiện ===== */
document.addEventListener('click', e => {
  if (!e.target.closest('.more') || e.target.closest('.menu button, .menu a')) document.querySelectorAll('.more[open]').forEach(d => d.removeAttribute('open'));
  const t = e.target.closest('[data-tab],[data-st],[data-sv],[data-a],[data-quick]'); if (!t) return;
  const d = t.dataset;
  if (d.tab) { tab = d.tab; try { localStorage.setItem('tts-tab', tab); } catch { /* bỏ qua */ } return render(); }
  if (d.st !== undefined) { F.st = d.st; return render(); }
  if (d.sv) { F.stockView = d.sv; return render(); }
  if (d.quick) { const x = $('#cm-text'); x.value = d.quick; return x.focus(); }
  const a = d.a, g = d.g && groupOf(d.g);
  if (a.startsWith('g:') && g) {
    const act = a.slice(2);
    if (act === 'close') {
      const un = g.items.filter(i => i.status === 'moi' && !TICKS.has(i.id)).length, n = g.items.filter(i => i.status === 'moi').length;
      if (n > 1 && un && un < n && !confirm(`Còn ${un}/${n} đôi chưa tick. Vẫn đóng cả kiện?`)) return;
      g.items.forEach(i => TICKS.delete(i.id));
    }
    if (act === 'cancel' && !confirm('Hủy cả đơn này? Hàng tồn đã dùng (nếu có) sẽ được trả lại kho.')) return;
    return groupAction(g, act);
  }
  if (a.startsWith('line:')) { const o = S.orders.find(x => x.id === d.id), ops = []; if (o) { changeStatus(o, a.slice(5), ops); save(ops); render(); } return; }
  switch (a) {
    case 'reload': setSync('Đang tải…'); return refresh(true);
    case 'new': return newOrderModal();
    case 'bulk': return bulkModal();
    case 'save-order': return saveOrder();
    case 'bulk-save': return bulkSave();
    case 'close': return closeModal();
    case 'al-add': { const p = ADD.lines[ADD.lines.length - 1]; ADD.lines.push(newLine({ product: p.product, color: p.color, kem: p.kem, size: p.size })); return drawLines(); }
    case 'al-del': ADD.lines.splice(+d.i, 1); return drawLines();
    case 'al-note': { ADD.lines[+d.i].showNote = true; drawLines(); const inp = document.querySelector(`.aline[data-i="${d.i}"] [data-k=note]`); if (inp) inp.focus(); return; }
    case 'edit': return editModal(d.g);
    case 'e-cancel': case 'e-reopen': {
      const l = EDIT.lines[+d.i], ops = [], o = S.orders.find(x => x.id === l.id);
      if (!o) return;
      changeStatus(o, a === 'e-cancel' ? 'huy' : 'moi', ops); save(ops); closeModal(); return toast(a === 'e-cancel' ? 'Đã hủy đôi này' : 'Đã mở lại');
    }
    case 'e-more': { const gg = groupOf(EDIT.gid), l = gg.items[gg.items.length - 1]; closeModal(); return newOrderModal({ code: gg.code, date: gg.date, line: { product: l.product, color: l.color, kem: l.kem, size: l.size } }); }
    case 'e-save': return saveEdit();
    case 'cm': return commentModal(d.g);
    case 'cm-send': {
      const text = $('#cm-text').value.trim(), gg = groupOf(d.g); if (!text || !gg) return;
      S.comments.push({ ts: Date.now(), who: ROLES[role], key: gg.id, text });
      save([{ t: 'comment', orderId: gg.id, text }]);
      return commentModal(d.g);
    }
    case 'bill': {
      const R = currentBill(); toast('Đang tạo file…');
      loadJs('export.js').then(() => Export.run(d.kind, d.fmt, R, { withList: F.billList !== false })).then(nm => toast('Đã tải ' + nm)).catch(err => toast(err.message));
      return;
    }
    case 'bill-list': F.billList = t.checked; return;
    case 'close-month': {
      const R = currentBill();
      if (!confirm(`Chốt tháng ${R.month.slice(5)}/${R.month.slice(0, 4)}?\nShop: ${fmtM(R.totals.shop)}đ · đối tác: ${fmtM(R.totals.partner)}đ (${fmtM(R.totals.pairs)} đôi).\nSố liệu được lưu trong tab "Chốt tháng" của Google Sheet.`)) return;
      save([{ t: 'month.close', month: R.month, pairs: R.totals.pairs, shop: R.totals.shop, partner: R.totals.partner, margin: R.totals.margin, detail: { days: R.days.map(x => ({ d: x.date, n: x.pairs, s: x.shopTotal, p: x.partnerTotal })), pricing: R.P } }]);
      return toast('Đang chốt tháng…');
    }
    case 'pricing-save': {
      const values = {}; document.querySelectorAll('[data-pr]').forEach(i => { values[i.dataset.pr] = i.value.trim(); });
      S.pricing = { ...(S.pricing || {}), ...values };
      save([{ t: 'pricing.save', values }]); return toast('Đã lưu bảng giá');
    }
    case 'csv': return exportCSV();
    case 'new-stock': return newStockModal();
    case 'new-goods': return newGoodsModal();
    case 'ng-save': return ngSave();
    case 'return-open': return returnModal();
    case 'rt-add': return rtAdd();
    case 'rt-del': RET.items = RET.items.filter(x => x.code !== d.code); return rtDraw();
    case 'rt-manual': { const code = d.code || ''; closeModal(); return newStockModal({ ref: code }); }
    case 'rt-save': return rtSave();
    case 'check-open': return checkModal();
    case 'ck-extra': CK.extra.push({ product: '', size: '', color: '', book: 0, actual: '' }); $('#ck-body').innerHTML = ckRows(); return ckSum();
    case 'ck-save': return ckSave();
    case 'ret-undo': {
      const st = S.stock.find(x => x.id === d.id); if (!st) return;
      if (!confirm('Hoàn tác nhập hoàn này? Đôi này sẽ bị bỏ khỏi kho (đánh dấu Thất thoát) và đơn gốc trở về Đã giao.')) return;
      const m = /Hoàn từ đơn (D\d+)/.exec(st.note), o = m && S.orders.find(x => x.id === m[1]);
      st.state = 'mat'; if (o && o.status === 'hoan') o.status = 'da_giao';
      save([{ t: 'return.undo', id: st.id }]); return render();
    }
    case 'stock-save': return saveStock();
    case 'stock-use': { const s = S.stock.find(x => x.id === d.id); s.used = true; s.state = 'used'; s.usedDate = today(); save([{ t: 'stock.use', id: s.id }]); return render(); }
    case 'stock-free': { const s = S.stock.find(x => x.id === d.id); s.used = false; s.state = 'con'; s.usedDate = ''; s.usedBy = ''; save([{ t: 'stock.free', id: s.id }]); return render(); }
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  // Form thêm đơn / sửa đơn: cập nhật dữ liệu nháp, không vẽ lại cả form
  if (el.closest('#modal')) {
    if (NG && el.dataset.ng) {
      if (el.dataset.ng === 'productSel') {
        if (el.value === '__other__') { NG.custom = true; NG.product = ''; } else { NG.custom = false; NG.product = el.value; }
        ngProdDraw(); if (NG.custom) { const i2 = document.querySelector('#ng-prod [data-ng=product]'); if (i2) i2.focus(); }
      } else NG.product = el.value;
      return;
    }
    if (NG && (el.dataset.ngs !== undefined || el.dataset.ngo)) { ngSum(); return; }
    if (RET && el.dataset.rt) {
      const x = RET.items.find(y => y.id === el.dataset.id);
      if (x) { if (el.dataset.rt === 'on') x.on = el.checked; else x.cond = el.value; rtDraw(); }
      return;
    }
    if (CK && el.id === 'ck-q') { const q = el.value.toLowerCase(); document.querySelectorAll('#ck-body tr').forEach(tr => { tr.style.display = !q || tr.dataset.ck[0] === 'x' || (tr.dataset.q || '').includes(q) ? '' : 'none'; }); return; }
    if (CK && el.dataset.ckv) { const arr = el.dataset.ckv[0] === 'r' ? CK.rows : CK.extra; arr[+el.dataset.ckv.slice(1)].actual = el.value; ckSum(); return; }
    if (CK && el.dataset.ckx) { CK.extra[+el.dataset.i][el.dataset.ckx] = el.value; return; }
    const row = el.closest('[data-i]'), i = row ? +row.dataset.i : -1;
    if (ADD && row && row.parentElement.id === 'alines') {
      const l = ADD.lines[i];
      if (el.dataset.k === 'productSel') {
        if (el.value === '__other__') { l.custom = true; l.product = ''; } else { l.custom = false; l.product = el.value; }
        l.stockIds = []; l.autoPick = l.src === 'stock'; drawLines();
        if (l.custom) { const inp = document.querySelector(`.aline[data-i="${i}"] [data-k=product]`); if (inp) inp.focus(); }
        return;
      }
      if (el.dataset.k) {
        l[el.dataset.k] = el.dataset.k === 'qty' ? Math.max(1, Math.min(+el.value || 1, 20)) : el.value;
        if (['product', 'size', 'color'].includes(el.dataset.k)) { l.stockIds = []; l.autoPick = l.src === 'stock'; }
        if (el.dataset.k === 'qty' && l.src === 'stock') l.autoPick = true;
        if (['product', 'size', 'color', 'qty'].includes(el.dataset.k)) ADD.lines.forEach((_, j) => updSug(j));
      } else if (el.type === 'radio' && el.name.startsWith('src-')) {
        l.src = el.value; l.autoPick = el.value === 'stock'; if (el.value === 'new') l.stockIds = [];
        ADD.lines.forEach((_, j) => updSug(j));
      } else if (el.dataset.stk) {
        if (el.checked && l.stockIds.length >= l.qty) { el.checked = false; toast('Dòng này chỉ cần ' + l.qty + ' đôi. Tăng số đôi nếu muốn lấy thêm.'); return; }
        l.stockIds = el.checked ? [...l.stockIds, el.dataset.stk] : l.stockIds.filter(x => x !== el.dataset.stk);
        ADD.lines.forEach((_, j) => updSug(j));
      }
      return;
    }
    if (EDIT && row && row.parentElement.id === 'elines' && el.dataset.e) {
      const l = EDIT.lines[i];
      if (el.dataset.e === 'productSel') {
        if (el.value === '__other__') { l.custom = true; l.product = ''; } else { l.custom = false; l.product = el.value; }
        $('#elines').innerHTML = EDIT.lines.map(eLineHtml).join('');
        if (l.custom) { const inp = document.querySelector(`#elines .aline[data-i="${i}"] [data-e=product]`); if (inp) inp.focus(); }
        return;
      }
      l[el.dataset.e] = el.value; return;
    }
  }
  const f = el.dataset.f; if (!f) return;
  F[f] = el.value;
  if (el.tagName === 'SELECT') return render();
  const pos = el.selectionStart; render();   // gõ tìm kiếm: giữ con trỏ trong ô nhập
  const i = document.querySelector(`[data-f="${f}"]`); if (i) { i.focus(); i.setSelectionRange(pos, pos); }
});
document.addEventListener('toggle', e => { if (e.target.id === 'stock-info') F.stockInfoOpen = e.target.open; }, true);
document.addEventListener('change', e => {
  const t = e.target.dataset && e.target.dataset.tick;
  if (t) { e.target.checked ? TICKS.add(t) : TICKS.delete(t); }
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
let pinging = false, ticks = 0;
async function pollTick() {
  if (!role || document.hidden || !$('#modal').hidden || busy || pinging) return;
  pinging = true;
  try {
    const p = await api('ping');
    ticks++;
    // không có gì mới thì thôi; cứ ~2 phút tải lại 1 lần để thấy cả chỗ sửa tay trực tiếp trong Sheet
    if (p.rev && S.rev && p.rev === S.rev && ticks % 8) return;
    await refresh();
  } catch (e) {
    if (/mật khẩu/i.test(e.message)) logout('Mật khẩu đã đổi, hãy đăng nhập lại.');
    else if (/không hợp lệ/i.test(e.message)) await refresh();   // backend cũ chưa có ping
    else setSync('Mất kết nối – ' + e.message, true);
  } finally { pinging = false; }
}
setInterval(pollTick, 15000);
document.addEventListener('visibilitychange', pollTick);

/* ===== Khởi động ===== */
(async function init() {
  if (!API) { $('#main').innerHTML = '<div class="card warn">Chưa cấu hình: dán link Apps Script vào config.js (xem README.md).</div>'; return; }
  if (PW) {
    const c = readCache();
    const cached = !!(c && c.role && c.orders);
    if (cached) { role = c.role; build(c); LAST = c; showApp(); setSync('Đang cập nhật…'); }
    try { await enter(cached); return; } catch (e) {
      if (/mật khẩu/i.test(e.message)) { logout(''); return; }
      if (cached) { setSync('Mất kết nối – đang xem dữ liệu lần trước', true); return; }
      PW = ''; showLogin('Không kết nối được: ' + e.message); return;
    }
  }
  showLogin();
})();

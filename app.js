'use strict';
/* Giao diện (GitHub Pages) <-> Apps Script <-> Google Sheet (các tab Đơn hàng, Tồn kho, Danh mục…).
   Toàn bộ dữ liệu nằm trong Google Sheet; trang này không lưu dữ liệu nào ngoài mật khẩu của người dùng trên máy họ. */

/* ===== Hằng số ===== */
let PRODUCTS = ['Nagaki Karyu', 'Nagaki Kakashi', 'Nagaki Katashi', 'Nagaki Nekketsu', 'Kizuma'];
let SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'];
let BASE_COLORS = ['xanh rêu', 'xanh ngọc', 'trắng đỏ', 'trắng', 'xanh đen', 'xanh bích', 'vàng', 'navy', 'đen', 'trắng đồng', 'cam'];
const ST = { moi: 'Chờ đóng', da_dong: 'Đã đóng', da_giao: 'Đã giao', khong_co: 'Không có hàng' };
const ROLES = { shop: 'Shop', kho: 'Kho', chu: 'Chủ' };
let KEMS = ['', 'bó gối', 'tất'];
const TABS = [['orders', 'Đơn hàng'], ['pack', 'Cần đóng'], ['stock', 'Tồn kho'], ['dash', 'Tổng quan']];
const API = (window.APP_CONFIG || {}).api;

/* ===== Tiện ích ===== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toLocaleDateString('sv');
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const fmtD = d => d ? d.slice(8) + '/' + d.slice(5, 7) : '';
const normColor = s => (s || '').toLowerCase().replace(/[']/g, '').replace(/\s+/g, ' ').trim();
const key = x => [x.product, x.size, x.color].join('|');
const label = x => `${x.product} · ${x.size} · ${cap(x.color)}`;
function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 2600); }
function setSync(t, bad) { const e = $('#sync'); e.textContent = t; e.style.color = bad ? 'var(--bad)' : ''; }

/* ===== Dữ liệu ===== */
let S = { orders: [], stock: [], comments: [], links: [], log: [] };
let role = null, PW = '';
try { PW = localStorage.getItem('tts-pw') || ''; } catch { /* bỏ qua */ }
let tab = 'orders';
try { tab = localStorage.getItem('tts-tab') || 'orders'; } catch { /* bỏ qua */ }
const F = { date: '', st: '', q: '', stockView: 'con', stockQ: '', month: '' };

async function api(action, x = {}) {
  if (!API) throw new Error('Chưa cấu hình link Apps Script (config.js)');
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ pw: PW, action, ...x }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
const ST_TO_CODE = Object.fromEntries(Object.entries(ST).map(([k, v]) => [v, k]));
function build(d) {
  const lc = x => String(x || '').toLowerCase().trim();
  const c = d.cats || {};
  if (c.products && c.products.length) PRODUCTS = c.products;
  if (c.sizes && c.sizes.length) SIZES = c.sizes.map(String);
  if (c.colors && c.colors.length) BASE_COLORS = c.colors.map(normColor);
  if (c.kems && c.kems.length) KEMS = ['', ...c.kems.map(lc)];
  S.orders = d.orders.map(o => ({
    id: o.id, key: o.id, date: String(o.date).slice(0, 10), product: o.product, size: String(o.size), color: normColor(o.color), code: String(o.code || ''),
    kem: lc(o.kem), fromStock: o.src === 'Hàng tồn', status: ST_TO_CODE[o.st] || 'moi', notes: o.note ? [String(o.note)] : [],
  })).filter(o => o.product);
  S.stock = d.stock.map(x => ({
    id: x.id, date: String(x.date).slice(0, 10), type: x.type === 'Hàng lấy dư' ? 'du' : 'hoan', product: x.product, size: String(x.size), color: normColor(x.color),
    ref: String(x.ref || ''), used: x.st === 'Đã dùng', usedDate: String(x.used || '').slice(0, 10), usedBy: String(x.forOrder || ''),
  })).filter(x => x.product);
  S.comments = d.comments.map(([ts, who, k, text]) => ({ ts: Date.parse(ts) || 0, who, key: String(k), text }));
  S.log = d.log.map(([ts, who, k, text]) => ({ ts: Date.parse(ts) || 0, who, key: String(k), text }));
}
let busy = 0, chain = Promise.resolve();
// Ghi lên sheet lần lượt (không chạy song song), xong thì tải lại dữ liệu mới nhất.
function save(ops) {
  busy++; setSync('Đang lưu…');
  chain = chain.then(() => api('write', { ops })).then(r => {
    const rs = r.results || [];
    if (rs.some(x => x.stockTaken)) toast('Đôi tồn đã có người dùng trước nên đơn được tạo như hàng mới.');
    else if (rs.some(x => x.conflict)) toast('Có đơn vừa được người khác thay đổi. Đã tải lại dữ liệu mới nhất.');
    else { const bad = rs.find(x => x.error); if (bad) toast(bad.error); }
  }).catch(e => toast(e.message)).then(async () => { busy--; if (!busy) await refresh(true); });
  return chain;
}
async function refresh(force) {
  if (busy && !force) return;
  try {
    build(await api('load'));
    setSync('Đã đồng bộ ' + new Date().toLocaleTimeString('vi-VN'));
    const ae = document.activeElement;
    if (!(ae && ae.closest && ae.closest('#main') && /INPUT|TEXTAREA/.test(ae.tagName))) render();
  } catch (e) {
    if (/mật khẩu/i.test(e.message)) logout('Mật khẩu đã đổi, hãy đăng nhập lại.');
    else setSync('Mất kết nối – ' + e.message, true);
  }
}

/* ===== Đăng nhập ===== */
function showLogin(msg) { $('#login').hidden = false; $('#login-err').textContent = msg || ''; $('#pw').focus(); }
function logout(msg) {
  try { localStorage.removeItem('tts-pw'); } catch { /* bỏ qua */ }
  PW = ''; role = null; S = { orders: [], stock: [], comments: [], links: [], log: [] };
  $('#main').innerHTML = ''; $('#tabs').innerHTML = ''; $('#me').textContent = ''; $('#logout').hidden = true; setSync('');
  showLogin(msg);
}
async function enter() {
  const j = await api('login');
  role = j.role;
  setSync('Đang tải…');
  const d = await api('load'); build(d);
  $('#login').hidden = true; $('#me').textContent = 'Vai trò: ' + ROLES[role]; $('#logout').hidden = false;
  try { localStorage.setItem('tts-pw', PW); } catch { /* bỏ qua */ }
  const dates = S.orders.map(o => o.date).sort();
  F.date = S.orders.some(o => o.date === today()) ? today() : (dates[dates.length - 1] || '');
  F.month = (dates[dates.length - 1] || today()).slice(0, 7);
  setSync('Đã đồng bộ ' + new Date().toLocaleTimeString('vi-VN'));
  render();
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  PW = $('#pw').value; $('#login-err').textContent = 'Đang kiểm tra…';
  try { await enter(); $('#pw').value = ''; $('#login-err').textContent = ''; } catch (err) { PW = ''; $('#login-err').textContent = err.message; }
});
$('#logout').onclick = () => logout();

/* ===== Nghiệp vụ ===== */
const can = (...r) => r.includes(role) || role === 'chu';
const availStock = () => S.stock.filter(s => !s.used);
const matches = o => availStock().filter(s => key(s) === key(o));
// Đổi trạng thái: cập nhật ngay trên màn hình, server làm phần còn lại (trả tồn, nhật ký…)
function changeStatus(o, st, ops) {
  ops.push({ t: 'order.status', id: o.id, status: ST[st], from: ST[o.status] });
  if (st === 'moi' && o.status !== 'khong_co') {
    S.stock.filter(x => x.usedBy === o.id && x.used).forEach(x => { x.used = false; x.usedDate = ''; x.usedBy = ''; });
    o.fromStock = false;
  }
  o.status = st;
}
const colorList = () => [...new Set([...BASE_COLORS, ...S.orders.map(o => o.color), ...S.stock.map(s => s.color)].filter(Boolean))];

/* ===== Giao diện chung ===== */
function render() {
  if (!role) return;
  $('#tabs').innerHTML = TABS.map(([k, t]) => {
    const n = k === 'pack' ? S.orders.filter(o => o.status === 'moi').length : 0;
    return `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${t}${n ? ` (${n})` : ''}</button>`;
  }).join('');
  ({ orders: vOrders, pack: vPack, stock: vStock, dash: vDash }[tab] || vOrders)();
}
const badge = s => `<span class="badge b-${s}">${ST[s]}</span>`;
const opts = (arr, sel) => arr.map(v => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="mbox">${html}</div>`; m.hidden = false; }
function closeModal() { $('#modal').hidden = true; render(); }

/* ===== Đơn hàng ===== */
function filteredOrders() {
  const q = F.q.toLowerCase();
  return S.orders.filter(o => (!F.date || o.date === F.date) && (!F.st || o.status === F.st) &&
    (!q || (o.code + ' ' + o.product + ' ' + o.color + ' ' + o.size).toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
function actionsFor(o) {
  const a = [];
  const b = (act, t, c = '') => a.push(`<button class="btn sm ${c}" data-a="${act}" data-id="${o.id}">${t}</button>`);
  if (o.status === 'moi' && can('kho')) { b('st:da_dong', 'Đã đóng', 'ok'); b('st:khong_co', 'Không có hàng', 'bad'); }
  if (o.status === 'da_dong') { if (can('kho', 'shop')) b('st:da_giao', 'Đã giao', 'ok'); if (can('kho')) b('st:moi', 'Hoàn tác'); }
  if (o.status === 'da_giao' && can('kho')) b('st:da_dong', 'Hoàn tác');
  if (o.status === 'khong_co' && can('shop')) b('st:moi', 'Mở lại');
  return a.join('');
}
function vOrders() {
  const dates = [...new Set(S.orders.map(o => o.date))].sort().reverse();
  const base = S.orders.filter(o => !F.date || o.date === F.date);
  const cnt = s => base.filter(o => o.status === s).length;
  const rows = filteredOrders();
  $('#main').innerHTML = `
  <div class="bar">
    <select data-f="date"><option value="">Tất cả ngày</option>${dates.map(d => `<option value="${d}" ${d === F.date ? 'selected' : ''}>${fmtD(d)}/${d.slice(0, 4)}</option>`).join('')}</select>
    <input data-f="q" placeholder="Tìm mã đơn, sản phẩm, màu…" value="${esc(F.q)}">
    <span class="sp"></span>
    <button class="btn" data-a="reload">⟳ Tải lại</button>
    <button class="btn" data-a="csv">⬇ Xuất CSV</button>
    ${can('shop') ? '<button class="btn" data-a="bulk">Dán nhiều đơn</button><button class="btn pri" data-a="new">+ Thêm đơn</button>' : ''}
  </div>
  <div class="chips" style="margin-bottom:12px">
    <span class="chip ${F.st === '' ? 'on' : ''}" data-st="">Tất cả ${base.length}</span>
    ${Object.keys(ST).map(s => `<span class="chip ${F.st === s ? 'on' : ''}" data-st="${s}">${ST[s]} ${cnt(s)}</span>`).join('')}
  </div>
  <div class="wrap"><table class="tbl"><thead><tr><th>Ngày</th><th>Sản phẩm</th><th>Size</th><th>Màu</th><th>Mã đơn</th><th>Kèm</th><th>Nguồn</th><th>Trạng thái</th><th></th><th></th></tr></thead><tbody>
  ${rows.slice(0, 400).map(o => {
    const nc = S.comments.filter(c => c.key === o.key).length + (o.notes || []).length;
    const has = o.status === 'moi' && !o.fromStock && matches(o).length;
    return `<tr><td>${fmtD(o.date)}</td><td>${esc(o.product)}</td><td>${esc(o.size)}</td><td>${esc(cap(o.color))}</td>
    <td class="code">${esc(o.code) || '<span class="mut">—</span>'}</td><td>${o.kem ? `<span class="tag">${esc(o.kem)}</span>` : ''}</td>
    <td>${o.fromStock ? '<span class="tag stock">Hàng tồn</span>' : has ? `<span class="tag stock" title="Kho đang có tồn đúng mẫu này">Có tồn ${has}</span>` : '<span class="mut">Mới</span>'}</td>
    <td>${badge(o.status)}</td><td><div class="acts">${actionsFor(o)}</div></td>
    <td><button class="btn sm" data-a="cm" data-id="${o.id}">💬${nc ? ' ' + nc : ''}</button></td></tr>`;
  }).join('') || '<tr><td colspan="10" class="mut">Không có đơn nào.</td></tr>'}
  </tbody></table></div>${rows.length > 400 ? `<p class="mut">Đang hiện 400/${rows.length} đơn – hãy lọc theo ngày.</p>` : ''}`;
}

function newOrderModal(pre = {}) {
  const d = { product: PRODUCTS[0], size: '40', color: '', kem: '', code: '', date: today(), ...pre };
  modal(`<h3>Thêm đơn</h3>
  <div class="fld"><label>Ngày</label><input type="date" id="f-date" value="${d.date}"></div>
  <div class="fld"><label>Sản phẩm</label><select id="f-product">${opts(PRODUCTS, d.product)}</select></div>
  <div class="fld"><label>Size</label><select id="f-size">${opts(SIZES, d.size)}</select></div>
  <div class="fld"><label>Màu</label><input id="f-color" list="dl-color" value="${esc(d.color)}" placeholder="chọn hoặc gõ"><datalist id="dl-color">${colorList().map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
  <div class="fld"><label>Mã đơn</label><input id="f-code" inputmode="numeric" value="${esc(d.code)}" placeholder="vd: 802868950124"></div>
  <div class="fld"><label>Đóng kèm</label><select id="f-kem">${KEMS.map(k => `<option value="${k}">${k || '(không)'}</option>`).join('')}</select></div>
  <div id="sugg"></div>
  <div class="row"><button class="btn" data-a="close">Huỷ</button><button class="btn pri" data-a="save-order">Lưu đơn</button></div>`);
  const upd = () => {
    const x = { product: $('#f-product').value, size: $('#f-size').value, color: normColor($('#f-color').value) };
    const m = x.color ? matches(x) : [];
    $('#sugg').innerHTML = m.length ? `<div class="sugg"><b>Kho đang có ${m.length} đôi tồn đúng mẫu này</b> – dùng lại thay vì đặt mới?
      <label><input type="radio" name="stk" value="" checked> Không, đặt hàng mới</label>
      ${m.map(s => `<label><input type="radio" name="stk" value="${s.id}"> Dùng tồn: ${s.type === 'hoan' ? 'hàng hoàn' : 'hàng lấy dư'} ${fmtD(s.date)}${s.ref ? ' · ' + esc(s.ref) : ''}</label>`).join('')}</div>` : '';
  };
  ['f-product', 'f-size', 'f-color'].forEach(i => $('#' + i).addEventListener('input', upd));
  upd();
}
// Thêm một hay nhiều đơn trong một lần ghi. items: [{d, stock}]
function addOrders(items) {
  const ops = items.map(({ d, stock }) => {
    if (stock) { stock.used = true; stock.usedDate = today(); }
    return { t: 'order.add', date: d.date || today(), product: d.product, size: d.size, color: cap(normColor(d.color)), code: d.code || '', kem: cap(d.kem || ''), stockId: stock ? stock.id : undefined };
  });
  return save(ops);
}
function saveOrder() {
  const d = { date: $('#f-date').value, product: $('#f-product').value, size: $('#f-size').value, color: $('#f-color').value, code: $('#f-code').value.replace(/\D/g, ''), kem: $('#f-kem').value };
  if (!normColor(d.color)) return toast('Chọn màu trước nhé');
  if (d.code && S.orders.some(o => o.code === d.code) && !confirm('Mã đơn này đã có trong sheet. Vẫn thêm?')) return;
  const sel = document.querySelector('input[name=stk]:checked');
  addOrders([{ d, stock: sel && sel.value ? S.stock.find(s => s.id === sel.value) : null }]);
  closeModal(); toast('Đang thêm đơn vào Google Sheet…');
}

function parseLine(line) {
  let t = line.toLowerCase(), code = '';
  const cm = t.match(/\b\d{9,14}\b/); if (cm) { code = cm[0]; t = t.replace(code, ' '); }
  const sm = t.match(/\b(3[5-9]|4[0-6])\b/);
  const pm = [['karyu', 'Nagaki Karyu'], ['kakashi', 'Nagaki Kakashi'], ['katashi|takashi', 'Nagaki Katashi'], ['netketsu|nekketsu', 'Nagaki Nekketsu'], ['kizuma', 'Kizuma']].find(([r]) => new RegExp(r).test(t));
  const color = colorList().sort((a, b) => b.length - a.length).find(c => t.includes(c)) || '';
  return { product: pm && pm[1], size: sm && sm[1], color, code, kem: /bó gối/.test(t) ? 'bó gối' : /\btất\b/.test(t) ? 'tất' : '' };
}
function bulkModal() {
  modal(`<h3>Dán nhiều đơn</h3><p class="mut">Mỗi dòng một đơn. Ví dụ: <span class="code">nagaki karyu 42 xanh ngọc 802868950124 bó gối</span></p>
  <textarea id="bulk" rows="9" placeholder="Dán danh sách đơn ở đây…"></textarea><div id="bulk-res" class="mut"></div>
  <div class="row"><button class="btn" data-a="close">Huỷ</button><button class="btn pri" data-a="bulk-save">Thêm các đơn hợp lệ</button></div>`);
  $('#bulk').oninput = () => {
    const ls = $('#bulk').value.split('\n').filter(l => l.trim()).map(parseLine);
    const ok = ls.filter(x => x.product && x.size && x.color).length;
    $('#bulk-res').textContent = `${ok} dòng hợp lệ${ls.length - ok ? ` · ${ls.length - ok} dòng thiếu sản phẩm/size/màu (sẽ bỏ qua)` : ''}`;
  };
}
function bulkSave() {
  const ls = $('#bulk').value.split('\n').filter(l => l.trim()).map(parseLine).filter(x => x.product && x.size && x.color);
  const dup = new Set(S.orders.map(o => o.code)); let skip = 0; const items = [];
  ls.forEach(x => { if (x.code && dup.has(x.code)) { skip++; return; } dup.add(x.code); items.push({ d: x }); });
  if (items.length) addOrders(items);
  closeModal(); toast(`Đang thêm ${items.length} đơn${skip ? `, bỏ qua ${skip} đơn trùng mã` : ''}…`);
}

const QUICK = ['Không có hàng', 'Đã đóng rồi', 'Khách đổi size', 'Dùng hàng tồn', 'Đã giao rồi'];
function commentModal(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  const cs = S.comments.filter(c => c.key === o.key).sort((a, b) => a.ts - b.ts);
  const lg = S.log.filter(c => c.key === o.key).sort((a, b) => a.ts - b.ts);
  modal(`<h3>${esc(label(o))}</h3><div class="mut">Mã: <span class="code">${esc(o.code) || '—'}</span> · ${fmtD(o.date)} · ${ST[o.status]}</div>
  <div style="margin:10px 0">
  ${(o.notes || []).map(n => `<div class="cm"><small>Ghi chú trong Google Sheet</small><br>${esc(n)}</div>`).join('')}
  ${cs.map(c => `<div class="cm"><small>${esc(ROLES[c.who] || c.who)} · ${new Date(c.ts).toLocaleString('vi-VN')}</small><br>${esc(c.text)}</div>`).join('')}
  ${cs.length || (o.notes || []).length ? '' : '<p class="mut">Chưa có trao đổi nào.</p>'}
  </div>
  ${lg.length ? `<details style="margin-bottom:8px"><summary class="mut">Lịch sử thay đổi (${lg.length})</summary><div class="mut" style="font-size:13px">${lg.map(l => `${new Date(l.ts).toLocaleString('vi-VN')} · ${esc(ROLES[l.who] || l.who)}: ${esc(l.text)}`).join('<br>')}</div></details>` : ''}
  <div class="chips" style="margin-bottom:8px">${QUICK.map(q => `<span class="chip" data-quick="${esc(q)}">${q}</span>`).join('')}</div>
  <textarea id="cm-text" rows="2" placeholder="Nhắn cho người còn lại…"></textarea>
  <div class="row"><button class="btn" data-a="close">Đóng</button><button class="btn pri" data-a="cm-send" data-id="${id}">Gửi</button></div>`);
}

/* ===== Cần đóng (màn hình của Kho) ===== */
function vPack() {
  const list = S.orders.filter(o => o.status === 'moi');
  const groups = {};
  list.forEach(o => (groups[key(o)] = groups[key(o)] || []).push(o));
  const keys = Object.keys(groups).sort();
  const kem = list.reduce((m, o) => (o.kem && (m[o.kem] = (m[o.kem] || 0) + 1), m), {});
  $('#main').innerHTML = `<div class="grid">
    <div class="stat"><b>${list.length}</b><span>đơn chờ đóng</span></div>
    <div class="stat"><b>${keys.length}</b><span>mẫu khác nhau</span></div>
    <div class="stat"><b>${Object.entries(kem).map(([k, n]) => n + ' ' + k).join(', ') || '—'}</b><span>cần đóng kèm</span></div></div>
  ${keys.length ? '' : '<div class="card">🎉 Không còn đơn nào chờ đóng.</div>'}
  ${keys.map(k => {
    const g = groups[k], av = matches(g[0]).length;
    return `<details class="grp" ${g.length <= 3 ? 'open' : ''}><summary><b>${esc(label(g[0]))}</b><span class="badge b-moi">× ${g.length}</span>
      ${av ? `<span class="tag stock">kho tồn ${av}</span>` : ''}<span class="sp" style="flex:1"></span></summary><div class="in">
      ${can('kho') ? `<div><span class="sp"></span><button class="btn sm ok" data-a="pack-all" data-k="${esc(k)}">Đóng cả ${g.length} đơn</button></div>` : ''}
      ${g.map(o => `<div><span class="code">${esc(o.code) || '(chưa có mã)'}</span> <span class="mut">${fmtD(o.date)}</span>
        ${o.kem ? `<span class="tag">${esc(o.kem)}</span>` : ''}${o.fromStock ? '<span class="tag stock">Hàng tồn</span>' : ''}<span class="sp"></span>
        <div class="acts" style="padding:0;border:0">${actionsFor(o)}<button class="btn sm" data-a="cm" data-id="${o.id}">💬</button></div></div>`).join('')}
    </div></details>`;
  }).join('')}`;
}

/* ===== Tồn kho ===== */
function vStock() {
  const av = availStock(), q = F.stockQ.toLowerCase();
  const piv = {}; av.forEach(s => piv[key(s)] = (piv[key(s)] || 0) + 1);
  const rows = S.stock.filter(s => (F.stockView === 'all' || (F.stockView === 'con') === !s.used) && (!q || label(s).toLowerCase().includes(q) || (s.ref || '').includes(q)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  $('#main').innerHTML = `<div class="bar"><div class="chips">
    ${[['con', 'Còn hàng ' + av.length], ['used', 'Đã dùng lại ' + (S.stock.length - av.length)], ['all', 'Tất cả']].map(([k, t]) => `<span class="chip ${F.stockView === k ? 'on' : ''}" data-sv="${k}">${t}</span>`).join('')}</div>
    <input data-f="stockQ" placeholder="Tìm mẫu, màu, mã hoàn…" value="${esc(F.stockQ)}"><span class="sp"></span>
    ${can('kho') ? '<button class="btn pri" data-a="new-stock">+ Nhập hàng hoàn / dư</button>' : ''}</div>
  <div class="card"><b>Tồn hiện có theo mẫu</b><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
    ${Object.entries(piv).sort().map(([k, n]) => { const [p, s, c] = k.split('|'); return `<span class="tag stock">${esc(p)} · ${s} · ${esc(cap(c))} × ${n}</span>`; }).join('') || '<span class="mut">Kho trống</span>'}</div></div>
  <div class="wrap"><table class="tbl"><thead><tr><th>Ngày nhập</th><th>Loại</th><th>Mẫu</th><th>Mã đơn hoàn</th><th>Tình trạng</th><th></th></tr></thead><tbody>
  ${rows.map(s => { const o = s.usedBy && S.orders.find(x => x.id === s.usedBy);
    return `<tr><td>${fmtD(s.date)}</td><td>${s.type === 'hoan' ? 'Hàng hoàn' : 'Hàng lấy dư'}</td><td>${esc(label(s))}</td><td class="code">${esc(s.ref) || '—'}</td>
    <td>${s.used ? `<span class="badge b-da_dong">Đã dùng ${fmtD(s.usedDate)}${o ? ' · ' + esc(o.code || 'đơn mới') : ''}</span>` : '<span class="badge b-da_giao">Còn hàng</span>'}</td>
    <td><div class="acts">${can('kho', 'shop') ? (s.used ? `<button class="btn sm" data-a="stock-free" data-id="${s.id}">Hoàn tác</button>` : `<button class="btn sm" data-a="stock-use" data-id="${s.id}">Đánh dấu đã dùng</button>`) : ''}</div></td></tr>`; }).join('') || '<tr><td colspan="6" class="mut">Không có dòng nào.</td></tr>'}
  </tbody></table></div>`;
}
function newStockModal() {
  modal(`<h3>Nhập hàng hoàn / lấy dư</h3>
  <div class="fld"><label>Loại</label><select id="s-type"><option value="hoan">Hàng hoàn</option><option value="du">Hàng lấy dư</option></select></div>
  <div class="fld"><label>Sản phẩm</label><select id="s-product">${opts(PRODUCTS)}</select></div>
  <div class="fld"><label>Size</label><select id="s-size">${opts(SIZES, '40')}</select></div>
  <div class="fld"><label>Màu</label><input id="s-color" list="dl-c2"><datalist id="dl-c2">${colorList().map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
  <div class="fld"><label>Mã đơn hoàn</label><input id="s-ref" placeholder="(nếu có)"></div>
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
  const months = [...new Set(S.orders.map(o => o.date.slice(0, 7)))].sort().reverse();
  const L = S.orders.filter(o => o.date.startsWith(F.month));
  const by = f => L.reduce((m, o) => (m[f(o)] = (m[f(o)] || 0) + 1, m), {});
  const c = s => L.filter(o => o.status === s).length;
  const fromStock = L.filter(o => o.fromStock).length;
  const codes = {}; S.orders.forEach(o => o.code && (codes[o.code] = (codes[o.code] || 0) + 1));
  const dups = Object.keys(codes).filter(k => codes[k] > 1);
  const stale = S.orders.filter(o => o.status === 'moi' && o.date < today());
  const noCode = L.filter(o => !o.code).length;
  $('#main').innerHTML = `<div class="bar"><select data-f="month">${months.map(m => `<option value="${m}" ${m === F.month ? 'selected' : ''}>Tháng ${m.slice(5)}/${m.slice(0, 4)}</option>`).join('')}</select><span class="sp"></span>
    <span class="mut">Dữ liệu lấy trực tiếp từ Google Sheet</span></div>
  <div class="grid">
    <div class="stat"><b>${L.length}</b><span>tổng đơn</span></div>
    <div class="stat"><b>${c('da_giao')}</b><span>đã giao</span></div>
    <div class="stat"><b>${c('moi') + c('da_dong')}</b><span>chưa giao xong</span></div>
    <div class="stat"><b>${c('khong_co')}</b><span>không có hàng</span></div>
    <div class="stat"><b>${L.length ? Math.round(fromStock / L.length * 100) : 0}%</b><span>đơn dùng hàng tồn</span></div>
    <div class="stat"><b>${availStock().length}</b><span>đôi còn trong kho</span></div></div>
  ${stale.length ? `<div class="warn">⚠ ${stale.length} đơn của ngày trước vẫn đang <b>Chờ đóng</b>.</div>` : ''}
  ${dups.length ? `<div class="warn">⚠ ${dups.length} mã đơn bị nhập trùng: <span class="code">${dups.slice(0, 5).join(', ')}${dups.length > 5 ? '…' : ''}</span></div>` : ''}
  ${noCode ? `<div class="warn">⚠ ${noCode} đơn trong tháng chưa có mã đơn.</div>` : ''}
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="card"><b>Theo sản phẩm</b>${bars(by(o => o.product))}</div>
    <div class="card"><b>Theo màu</b>${bars(by(o => o.color))}</div>
    <div class="card"><b>Theo size</b>${bars(by(o => o.size))}</div></div>`;
}

/* ===== Xuất CSV ===== */
function exportCSV() {
  const h = ['Ngày', 'Sản phẩm', 'Size', 'Màu', 'Mã đơn hàng', 'Đóng kèm', 'Nguồn', 'Trạng thái'];
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [h, ...filteredOrders().reverse().map(o => [o.date, o.product, o.size, o.color, o.code, o.kem, o.fromStock ? 'Hàng tồn' : 'Mới', ST[o.status]])].map(r => r.map(cell).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'don-hang.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ===== Sự kiện ===== */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-st],[data-sv],[data-a],[data-quick]'); if (!t) return;
  const d = t.dataset;
  if (d.tab) { tab = d.tab; try { localStorage.setItem('tts-tab', tab); } catch { /* bỏ qua */ } return render(); }
  if (d.st !== undefined) { F.st = d.st; return render(); }
  if (d.sv) { F.stockView = d.sv; return render(); }
  if (d.quick) { const x = $('#cm-text'); x.value = d.quick; return x.focus(); }
  const a = d.a, o = d.id && S.orders.find(x => x.id === d.id);
  if (a.startsWith('st:')) {
    const ops = []; changeStatus(o, a.slice(3), ops); save(ops); return render();
  }
  switch (a) {
    case 'reload': setSync('Đang tải…'); return refresh(true);
    case 'new': return newOrderModal();
    case 'bulk': return bulkModal();
    case 'save-order': return saveOrder();
    case 'bulk-save': return bulkSave();
    case 'close': return closeModal();
    case 'cm': return commentModal(d.id);
    case 'cm-send': {
      const text = $('#cm-text').value.trim(); if (!text || !o) return;
      S.comments.push({ ts: Date.now(), who: ROLES[role], key: o.id, text });
      save([{ t: 'comment', orderId: o.id, text }]);
      return commentModal(d.id);
    }
    case 'pack-all': {
      const g = S.orders.filter(x => x.status === 'moi' && key(x) === d.k);
      if (confirm(`Đánh dấu đã đóng ${g.length} đơn?`)) { const ops = []; g.forEach(x => changeStatus(x, 'da_dong', ops)); save(ops); render(); toast(`Đang lưu ${g.length} đơn…`); }
      return;
    }
    case 'csv': return exportCSV();
    case 'new-stock': return newStockModal();
    case 'stock-save': return saveStock();
    case 'stock-use': { const s = S.stock.find(x => x.id === d.id); s.used = true; s.usedDate = today(); save([{ t: 'stock.use', id: s.id }]); return render(); }
    case 'stock-free': { const s = S.stock.find(x => x.id === d.id); s.used = false; s.usedDate = ''; s.usedBy = ''; save([{ t: 'stock.free', id: s.id }]); return render(); }
  }
});
document.addEventListener('input', e => {
  const f = e.target.dataset.f; if (!f) return;
  F[f] = e.target.value;
  if (e.target.tagName === 'SELECT') return render();
  const pos = e.target.selectionStart; render();   // gõ tìm kiếm: giữ con trỏ trong ô nhập
  const i = document.querySelector(`[data-f="${f}"]`); if (i) { i.focus(); i.setSelectionRange(pos, pos); }
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
setInterval(() => { if (role && !document.hidden && $('#modal').hidden) refresh(); }, 20000);
document.addEventListener('visibilitychange', () => { if (role && !document.hidden && $('#modal').hidden) refresh(); });

/* ===== Khởi động ===== */
(async function init() {
  if (!API) { $('#main').innerHTML = '<div class="card warn">Chưa cấu hình: dán link Apps Script vào config.js (xem README.md).</div>'; return; }
  if (PW) { try { await enter(); return; } catch (e) { PW = ''; showLogin(/mật khẩu/i.test(e.message) ? '' : 'Không kết nối được: ' + e.message); return; } }
  showLogin();
})();

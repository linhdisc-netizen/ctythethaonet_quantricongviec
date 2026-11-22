// Chuyển các dòng đọc từ Google Sheet thành đơn hàng / hàng tồn của app (chạy được cả trình duyệt lẫn Node).
(function (root) {
const prod = s => {
  s = String(s || '').toLowerCase();
  if (/karyu/.test(s)) return 'Nagaki Karyu';
  if (/kakashi/.test(s)) return 'Nagaki Kakashi';
  if (/katashi|takashi/.test(s)) return 'Nagaki Katashi';
  if (/netketsu|nekketsu/.test(s)) return 'Nagaki Nekketsu';
  if (/kizuma/.test(s)) return 'Kizuma';
  return null;
};
const col = s => { s = String(s || '').toLowerCase().replace(/[']/g, '').replace(/\s+/g, ' ').trim(); return s === 'vangf' ? 'vàng' : s; };
const kem = s => { s = String(s || '').toLowerCase(); return /bó gối/.test(s) ? 'bó gối' : /tất/.test(s) ? 'tất' : ''; };
const isDate = v => /^\d{4}-\d\d-\d\d$/.test(String(v || ''));
const num = v => v !== '' && v != null && !isNaN(+v);
const code = v => (num(v) ? String(Math.round(+v)) : String(v || '').replace(/\D/g, ''));
const raw = (r, keys) => Object.fromEntries(keys.map(k => [k, String(r[k] ?? '').trim()]));

function statusOf(J, K) {
  J = String(J || ''); K = String(K || '');
  return /❌/.test(J) ? 'khong_co' : /✔/.test(K) ? 'da_giao' : /✔/.test(J) ? 'da_dong' : 'moi';
}
// Ô J/K cần ghi để sheet thể hiện đúng trạng thái
const CELLS = {
  moi: { J: '', K: '' },
  da_dong: { J: '✔️', K: '' },
  da_giao: { J: '✔️', K: '✔️' },
  khong_co: { J: '❌️', K: '' },
};

function parseOrders(rows) {
  let d = null; const out = [];
  for (const r of rows) {
    if (r.row < 3) continue;
    if (isDate(r.A)) d = r.A;
    const p = prod(r.B);
    if (!p || !d || !num(r.C)) continue;
    out.push({
      row: r.row, date: d, product: p, size: String(+r.C), color: col(r.D), code: code(r.E),
      kem: kem(r.F), fromStock: /tồn/i.test(String(r.G || '')), status: statusOf(r.J, r.K),
      notes: [r.H, r.I].filter(t => t && isNaN(+t)).map(t => String(t).trim()),
      raw: raw(r, ['B', 'C', 'D', 'E']),
    });
  }
  return out;
}

function parseStock(rows) {
  let d = null, type = 'hoan'; const out = [];
  for (const r of rows) {
    if (r.row < 5) continue;
    if (isDate(r.B)) d = r.B;
    if (/lấy dư/i.test(String(r.C || ''))) type = 'du'; else if (/hoàn/i.test(String(r.C || ''))) type = 'hoan';
    const p = prod(r.E);
    if (!p || !num(r.F)) continue;
    out.push({
      row: r.row, date: d, type, product: p, size: String(+r.F), color: col(r.G), ref: String(r.D || '').trim(),
      usedDate: isDate(r.H) ? r.H : '', raw: raw(r, ['E', 'F', 'G']),
    });
  }
  return out;
}

root.Parse = { parseOrders, parseStock, statusOf, CELLS, prod, col };
})(typeof window !== 'undefined' ? window : module.exports);

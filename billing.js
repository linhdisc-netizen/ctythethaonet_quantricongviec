// Tính phí cuối tháng (chạy được cả trình duyệt lẫn Node để kiểm thử).
// Quy tắc đọc từ hai file tháng 10 của chủ shop:
//  - "đơn" = mỗi dòng (mỗi đôi) đã đóng, đếm theo NGÀY LÊN ĐƠN.
//  - Shop: đơn giá bậc thang theo số đôi trong ngày, áp cho cả ngày. Đơn nhiều đôi tính riêng.
//  - Đối tác: giá cố định mỗi đôi, đôi trong đơn nhiều đôi có giá riêng.
// Mọi con số nằm trong tab "Bảng giá" của Google Sheet, sửa được không cần sửa code.
(function (root) {
  const DEFAULTS = {
    shop_name: 'A Tính', partner_name: 'Chị Thương và Anh', issuer: 'Linh',
    shop_t1_max: 10, shop_t1_price: 10000, shop_t2_max: 30, shop_t2_price: 7000, shop_t3_max: 50, shop_t3_price: 6000,
    shop_t4_max: 100, shop_t4_price: 5000, shop_t5_price: 5000,
    bulk_on: 'Có', bulk_min: 5, shop_bulk_price: 5000, shop_bulk_big_min: 10, shop_bulk_big_price: 4000,
    partner_price: 5000, partner_bulk_price: 2500, count_returned: 'Có',
  };
  const NUMERIC = k => !['shop_name', 'partner_name', 'issuer', 'bulk_on', 'count_returned'].includes(k);
  function normPricing(raw) {
    const P = { ...DEFAULTS };
    Object.keys(raw || {}).forEach(k => { if (k in DEFAULTS) { const v = raw[k]; if (NUMERIC(k)) { const n = Number(String(v).replace(/[.,\s]/g, '')); if (isFinite(n) && String(v).trim() !== '') P[k] = n; } else if (String(v).trim() !== '') P[k] = String(v).trim(); } });
    return P;
  }
  const tierPrice = (n, P) => n < P.shop_t1_max ? P.shop_t1_price : n < P.shop_t2_max ? P.shop_t2_price : n < P.shop_t3_max ? P.shop_t3_price : n < P.shop_t4_max ? P.shop_t4_price : P.shop_t5_price;

  // lines: mọi dòng đơn [{id,date,status,code,product,size,color,kem}], status theo mã nội bộ (moi, da_dong, da_giao, khong_co, hoan, huy)
  function computeMonth(lines, month, Praw) {
    const P = normPricing(Praw);
    const kien = {};
    lines.forEach(l => { if (l.status !== 'huy') { const k = l.code ? 'c' + l.code : 'i' + l.id; kien[k] = (kien[k] || 0) + 1; } });
    const counted = l => l.status === 'da_dong' || l.status === 'da_giao' || (l.status === 'hoan' && P.count_returned === 'Có');
    const byDay = {}, rows = [];
    lines.filter(l => String(l.date).startsWith(month) && counted(l)).forEach(l => {
      const n = kien[l.code ? 'c' + l.code : 'i' + l.id] || 1;
      const bulk = P.bulk_on === 'Có' && n > P.bulk_min, big = bulk && n > P.shop_bulk_big_min;
      const d = byDay[l.date] = byDay[l.date] || { date: l.date, normal: 0, bulk: 0, bulkBig: 0 };
      if (!bulk) d.normal++; else if (big) d.bulkBig++; else d.bulk++;
      rows.push({ ...l, bulk, kienPairs: n });
    });
    const days = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)).map(d => {
      const price = d.normal ? tierPrice(d.normal, P) : 0;
      const shopNormal = d.normal * price, shopBulk = d.bulk * P.shop_bulk_price + d.bulkBig * P.shop_bulk_big_price;
      const partnerNormal = d.normal * P.partner_price, partnerBulk = (d.bulk + d.bulkBig) * P.partner_bulk_price;
      return { ...d, pairs: d.normal + d.bulk + d.bulkBig, tierPrice: price, shopNormal, shopBulk, shopTotal: shopNormal + shopBulk, partnerNormal, partnerBulk, partnerTotal: partnerNormal + partnerBulk };
    });
    const sum = k => days.reduce((a, d) => a + d[k], 0);
    const totals = { pairs: sum('pairs'), normal: sum('normal'), bulk: sum('bulk') + sum('bulkBig'), shop: sum('shopTotal'), partner: sum('partnerTotal') };
    totals.margin = totals.shop - totals.partner;
    rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.code).localeCompare(String(b.code)) || a.id.localeCompare(b.id));
    return { month, P, days, totals, rows };
  }
  const api = { DEFAULTS, normPricing, tierPrice, computeMonth };
  if (typeof module !== 'undefined') module.exports = api; else root.Billing = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* Xuất bảng chốt tháng ra Excel và PDF, chạy hoàn toàn trong trình duyệt (thư viện nằm trong thư mục vendor/).
   kind: 'shop' (bảng phí gửi Shop) hoặc 'partner' (bảng thanh toán cho kho / đối tác). Mỗi bản chỉ chứa giá của chính bên nhận. */
(function (root) {
  'use strict';
  const money = n => Number(n || 0).toLocaleString('vi-VN');
  const dmy = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const STATUS_TXT = { da_dong: 'Đã đóng', da_giao: 'Đã giao', hoan: 'Đã hoàn' };
  const loaded = {};
  const load = src => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Không tải được thư viện ' + src)); document.head.appendChild(s); }));
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  const fileName = (kind, month, ext) => `TONGDONHANG_T${month.slice(5)}-${month.slice(0, 4)}_${kind === 'shop' ? 'SHOP' : 'DOITAC'}.${ext}`;
  const recipient = (kind, P) => kind === 'shop' ? P.shop_name : P.partner_name;
  const docTitle = kind => kind === 'shop' ? 'BẢNG TÍNH PHÍ ĐÓNG HÀNG' : 'BẢNG THANH TOÁN PHÍ ĐÓNG HÀNG';
  const today = () => new Date().toLocaleDateString('sv');
  const hasBulk = R => R.P.bulk_on === 'Có' && R.totals.bulk > 0;

  // Dòng mô tả bảng giá áp dụng (chỉ giá của bên nhận)
  function priceLines(kind, R) {
    const P = R.P, L = [];
    if (kind === 'shop') {
      L.push(`Đơn thường, tính theo số đôi trong ngày (áp dụng cho cả ngày): dưới ${P.shop_t1_max} đôi: ${money(P.shop_t1_price)}đ/đôi; dưới ${P.shop_t2_max}: ${money(P.shop_t2_price)}đ; dưới ${P.shop_t3_max}: ${money(P.shop_t3_price)}đ; dưới ${P.shop_t4_max}: ${money(P.shop_t4_price)}đ; từ ${P.shop_t4_max} trở lên: ${money(P.shop_t5_price)}đ.`);
      if (P.bulk_on === 'Có') L.push(`Đơn nhiều đôi (hơn ${P.bulk_min} đôi/đơn): ${money(P.shop_bulk_price)}đ/đôi; đơn hơn ${P.shop_bulk_big_min} đôi: ${money(P.shop_bulk_big_price)}đ/đôi.`);
    } else {
      L.push(`Đơn thường: ${money(P.partner_price)}đ/đôi.`);
      if (P.bulk_on === 'Có') L.push(`Đơn nhiều đôi (hơn ${P.bulk_min} đôi/đơn): ${money(P.partner_bulk_price)}đ/đôi.`);
    }
    L.push('Số đôi tính theo ngày lên đơn; chỉ tính đôi đã đóng' + (P.count_returned === 'Có' ? ' (kể cả đôi sau đó được hoàn về).' : '.'));
    return L;
  }
  const dayAmount = (kind, d) => kind === 'shop' ? d.shopTotal : d.partnerTotal;
  const totalAmount = (kind, R) => kind === 'shop' ? R.totals.shop : R.totals.partner;

  /* ===================== EXCEL ===================== */
  async function buildXlsx(kind, R, opts) {
    await load('vendor/exceljs.min.js');
    const P = R.P, bulk = hasBulk(R), FONT = 'Arial';
    const wb = new ExcelJS.Workbook(); wb.creator = P.issuer || 'Đơn hàng TTS'; wb.created = new Date();
    const ws = wb.addWorksheet('Tổng hợp', { views: [{ showGridLines: false }] });
    const fnt = (o = {}) => ({ name: FONT, size: 10, ...o });
    const thin = { style: 'thin', color: { argb: 'FFBFC5D2' } }, border = { top: thin, bottom: thin, left: thin, right: thin };
    ws.getCell('A1').value = docTitle(kind); ws.getCell('A1').font = fnt({ bold: true, size: 15, color: { argb: 'FF2457D6' } });
    ws.getCell('A2').value = `Tháng ${R.month.slice(5)}/${R.month.slice(0, 4)}  —  Gửi: ${recipient(kind, P)}`; ws.getCell('A2').font = fnt({ bold: true, size: 11 });
    ws.getCell('A3').value = 'Đơn vị tính: đồng. Số đôi tính theo ngày lên đơn, chỉ tính đôi đã đóng.'; ws.getCell('A3').font = fnt({ italic: true, color: { argb: 'FF6B7385' } });
    const heads = kind === 'shop'
      ? (bulk ? ['Ngày', 'Số đôi\n(đơn thường)', 'Đơn giá\n(đ/đôi)', 'Thành tiền', `Số đôi trong đơn\nhơn ${P.bulk_min} đôi`, `Số đôi trong đơn\nhơn ${P.shop_bulk_big_min} đôi`, 'Thành tiền\nđơn nhiều đôi', 'Cộng trong ngày'] : ['Ngày', 'Số đôi giày đóng', 'Đơn giá (đ/đôi)', 'Thành tiền'])
      : (bulk ? ['Ngày', 'Số đôi\n(đơn thường)', 'Đơn giá\n(đ/đôi)', 'Thành tiền', `Số đôi trong đơn\nhơn ${P.bulk_min} đôi`, 'Đơn giá\n(đ/đôi)', 'Thành tiền\nđơn nhiều đôi', 'Cộng trong ngày'] : ['Ngày', 'Số đôi giày đóng', 'Đơn giá (đ/đôi)', 'Thành tiền']);
    const HR = 6, first = HR + 1, last = HR + R.days.length, TR = last + 1;
    heads.forEach((h, i) => { const c = ws.getCell(HR, i + 1); c.value = h; c.font = fnt({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2457D6' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = border; });
    ws.getRow(HR).height = bulk ? 42 : 24;
    // bảng giá áp dụng (cột J:L) - công thức bên trái tham chiếu vào đây
    const pb = (r, label, a, b) => { ws.getCell(`J${r}`).value = label; ws.getCell(`K${r}`).value = a; ws.getCell(`L${r}`).value = b; ['J', 'K', 'L'].forEach(c => { ws.getCell(`${c}${r}`).font = fnt(); ws.getCell(`${c}${r}`).border = border; }); ws.getCell(`K${r}`).numFmt = '#,##0'; ws.getCell(`L${r}`).numFmt = '#,##0'; };
    ws.getCell('J6').value = 'Bảng giá áp dụng'; ws.getCell('J6').font = fnt({ bold: true }); ws.getCell('K6').value = 'Số đôi dưới'; ws.getCell('L6').value = 'Đơn giá'; ['K6', 'L6'].forEach(a => ws.getCell(a).font = fnt({ bold: true }));
    if (kind === 'shop') {
      pb(7, 'Mức 1', P.shop_t1_max, P.shop_t1_price); pb(8, 'Mức 2', P.shop_t2_max, P.shop_t2_price); pb(9, 'Mức 3', P.shop_t3_max, P.shop_t3_price); pb(10, 'Mức 4', P.shop_t4_max, P.shop_t4_price); pb(11, 'Từ mức 4 trở lên', '', P.shop_t5_price);
      if (bulk) { pb(12, `Đơn hơn ${P.bulk_min} đôi (đ/đôi)`, '', P.shop_bulk_price); pb(13, `Đơn hơn ${P.shop_bulk_big_min} đôi (đ/đôi)`, '', P.shop_bulk_big_price); }
    } else { pb(7, 'Đơn thường (đ/đôi)', '', P.partner_price); if (bulk) pb(8, `Đơn hơn ${P.bulk_min} đôi (đ/đôi)`, '', P.partner_bulk_price); }
    R.days.forEach((d, i) => {
      const r = first + i, set = (col, v, fmt) => { const c = ws.getCell(`${col}${r}`); c.value = v; c.font = fnt(); c.border = border; c.numFmt = fmt || '#,##0'; c.alignment = { horizontal: col === 'A' ? 'center' : 'right' }; return c; };
      set('A', new Date(d.date + 'T00:00:00Z'), 'dd/mm/yyyy');
      set('B', d.normal);
      if (kind === 'shop') set('C', { formula: `IF(B${r}=0,0,IF(B${r}<$K$7,$L$7,IF(B${r}<$K$8,$L$8,IF(B${r}<$K$9,$L$9,IF(B${r}<$K$10,$L$10,$L$11)))))`, result: d.tierPrice });
      else set('C', { formula: '$L$7', result: P.partner_price });
      set('D', { formula: `B${r}*C${r}`, result: kind === 'shop' ? d.shopNormal : d.partnerNormal });
      if (bulk) {
        if (kind === 'shop') { set('E', d.bulk); set('F', d.bulkBig); set('G', { formula: `E${r}*$L$12+F${r}*$L$13`, result: d.shopBulk }); }
        else { set('E', d.bulk + d.bulkBig); set('F', { formula: '$L$8', result: P.partner_bulk_price }); set('G', { formula: `E${r}*F${r}`, result: d.partnerBulk }); }
        set('H', { formula: `D${r}+G${r}`, result: dayAmount(kind, d) });
      }
    });
    // dòng tổng
    const cols = bulk ? ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] : ['A', 'B', 'C', 'D'];
    cols.forEach(col => { const c = ws.getCell(`${col}${TR}`); c.font = fnt({ bold: true }); c.border = border; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEFC' } }; c.numFmt = '#,##0'; c.alignment = { horizontal: col === 'A' ? 'center' : 'right' }; });
    ws.getCell(`A${TR}`).value = 'TỔNG CỘNG';
    const sumCols = bulk ? (kind === 'shop' ? ['B', 'D', 'E', 'F', 'G', 'H'] : ['B', 'D', 'E', 'G', 'H']) : ['B', 'D'];
    const sumVal = { B: R.days.reduce((a, d) => a + d.normal, 0), D: R.days.reduce((a, d) => a + (kind === 'shop' ? d.shopNormal : d.partnerNormal), 0), E: R.days.reduce((a, d) => a + (kind === 'shop' ? d.bulk : d.bulk + d.bulkBig), 0), F: R.days.reduce((a, d) => a + d.bulkBig, 0), G: R.days.reduce((a, d) => a + (kind === 'shop' ? d.shopBulk : d.partnerBulk), 0), H: totalAmount(kind, R) };
    sumCols.forEach(col => { ws.getCell(`${col}${TR}`).value = { formula: `SUM(${col}${first}:${col}${last})`, result: sumVal[col] }; });
    const grand = bulk ? `H${TR}` : `D${TR}`;
    ws.getCell(`A${TR + 2}`).value = 'TỔNG SỐ ĐÔI TÍNH PHÍ'; ws.getCell(`A${TR + 2}`).font = fnt({ bold: true });
    ws.getCell(`D${TR + 2}`).value = { formula: bulk ? `B${TR}+E${TR}` : `B${TR}`, result: R.totals.pairs }; ws.getCell(`D${TR + 2}`).font = fnt({ bold: true }); ws.getCell(`D${TR + 2}`).numFmt = '#,##0';
    ws.getCell(`A${TR + 3}`).value = 'TỔNG TIỀN (đồng)'; ws.getCell(`A${TR + 3}`).font = fnt({ bold: true, size: 12, color: { argb: 'FFC62828' } });
    ws.getCell(`D${TR + 3}`).value = { formula: grand, result: totalAmount(kind, R) }; ws.getCell(`D${TR + 3}`).font = fnt({ bold: true, size: 12, color: { argb: 'FFC62828' } }); ws.getCell(`D${TR + 3}`).numFmt = '#,##0';
    priceLines(kind, R).forEach((t, i) => { const c = ws.getCell(`A${TR + 5 + i}`); c.value = (i === 0 ? 'Ghi chú: ' : '') + t; c.font = fnt({ italic: true, color: { argb: 'FF6B7385' } }); });
    ws.getCell(`A${TR + 9}`).value = `Người lập: ${P.issuer}  —  Ngày lập: ${dmy(today())}`; ws.getCell(`A${TR + 9}`).font = fnt();
    ws.columns = [{ width: 14 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 3 }, { width: 28 }, { width: 13 }, { width: 11 }];
    ws.views = [{ state: 'frozen', ySplit: HR, showGridLines: false }];
    ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    if (opts.withList) {
      const ls = wb.addWorksheet('Danh sách đơn', { views: [{ state: 'frozen', ySplit: 1 }] });
      const hd = ['STT', 'Ngày', 'Mã đơn', 'Sản phẩm', 'Size', 'Màu', 'Đóng kèm', 'Trạng thái', 'Đơn nhiều đôi'];
      ls.addRow(hd).eachCell(c => { c.font = fnt({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2457D6' } }; c.alignment = { horizontal: 'center' }; });
      R.rows.forEach((r, i) => ls.addRow([i + 1, new Date(r.date + 'T00:00:00Z'), String(r.code || ''), r.product, r.size, r.color, r.kem || '', STATUS_TXT[r.status] || r.status, r.bulk ? 'Có' : '']));
      ls.getColumn(2).numFmt = 'dd/mm/yyyy'; ls.getColumn(3).numFmt = '@';
      ls.eachRow((row, i) => { if (i > 1) row.eachCell(c => { c.font = fnt(); }); });
      ls.columns = [{ width: 6 }, { width: 12 }, { width: 17 }, { width: 22 }, { width: 8 }, { width: 14 }, { width: 22 }, { width: 12 }, { width: 14 }];
      ls.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
    }
    return wb.xlsx.writeBuffer();
  }

  /* ===================== PDF ===================== */
  async function buildPdf(kind, R, opts) {
    await Promise.all([load('vendor/pdf-lib.min.js'), load('vendor/fontkit.umd.min.js')]);
    const { PDFDocument, rgb } = PDFLib, P = R.P, bulk = hasBulk(R);
    const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
    const [fr, fb] = await Promise.all(['vendor/Roboto-Regular.ttf', 'vendor/Roboto-Bold.ttf'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error('Không tải được phông chữ'); return r.arrayBuffer(); })));
    const font = await doc.embedFont(fr, { subset: true }), bold = await doc.embedFont(fb, { subset: true });
    doc.setTitle(`${docTitle(kind)} tháng ${R.month.slice(5)}/${R.month.slice(0, 4)}`); doc.setAuthor(P.issuer || 'Đơn hàng TTS');
    const W = 595.28, H = 841.89, M = 38, INK = rgb(0.11, 0.14, 0.2), MUT = rgb(0.42, 0.45, 0.52), BLUE = rgb(0.14, 0.34, 0.84);
    let page, y;
    const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
    const fit = (t, w, size, f) => { t = String(t ?? ''); if (f.widthOfTextAtSize(t, size) <= w) return t; while (t.length > 1 && f.widthOfTextAtSize(t + '…', size) > w) t = t.slice(0, -1); return t + '…'; };
    const put = (t, x, yy, size, f = font, color = INK, align = 'left', w = 0) => { t = String(t ?? ''); const tw = f.widthOfTextAtSize(t, size); page.drawText(t, { x: align === 'right' ? x + w - tw : align === 'center' ? x + (w - tw) / 2 : x, y: yy, size, font: f, color }); };
    const wrapLine = (t, w, size) => { const out = []; let line = ''; for (const word of String(t).split(' ')) { const test = line ? line + ' ' + word : word; if (font.widthOfTextAtSize(test, size) > w && line) { out.push(line); line = word; } else line = test; } if (line) out.push(line); return out; };
    function table(cols, rows, o = {}) {
      const rh = o.rowH || 16, hh = o.headH || 30, tw = cols.reduce((a, c) => a + c.w, 0), x0 = M;
      const head = () => { if (y - hh < M + 30) newPage(); page.drawRectangle({ x: x0, y: y - hh, width: tw, height: hh, color: BLUE }); let x = x0; cols.forEach(c => { const lines = String(c.h).split('\n'); lines.forEach((ln, k) => put(ln, x, y - (hh / 2) + ((lines.length - 1) / 2 - k) * 10 - 3, 8.5, bold, rgb(1, 1, 1), 'center', c.w)); x += c.w; }); y -= hh; };
      head();
      rows.forEach((r, i) => {
        if (y - rh < M + 30) { newPage(); head(); }
        const isTotal = o.totalLast && i === rows.length - 1;
        if (isTotal) page.drawRectangle({ x: x0, y: y - rh, width: tw, height: rh, color: rgb(0.91, 0.93, 0.99) }); else if (i % 2) page.drawRectangle({ x: x0, y: y - rh, width: tw, height: rh, color: rgb(0.965, 0.97, 0.98) });
        let x = x0; cols.forEach((c, k) => { const f = isTotal ? bold : font; put(fit(r[k], c.w - 8, 9, f), x + 4, y - rh + 5, 9, f, INK, c.align || 'left', c.w - 8); x += c.w; });
        page.drawLine({ start: { x: x0, y: y - rh }, end: { x: x0 + tw, y: y - rh }, thickness: 0.4, color: rgb(0.8, 0.82, 0.86) });
        y -= rh;
      });
    }
    newPage();
    put(docTitle(kind), M, y - 14, 16, bold, BLUE); y -= 36;
    put(`Tháng ${R.month.slice(5)}/${R.month.slice(0, 4)}  —  Gửi: ${recipient(kind, P)}`, M, y, 11.5, bold); y -= 16;
    put('Đơn vị tính: đồng. Số đôi tính theo ngày lên đơn, chỉ tính đôi đã đóng.', M, y, 9, font, MUT); y -= 22;
    const dayRows = R.days.map(d => {
      const base = [dmy(d.date), String(d.normal), kind === 'shop' ? money(d.tierPrice) : money(P.partner_price), money(kind === 'shop' ? d.shopNormal : d.partnerNormal)];
      if (!bulk) return base;
      return kind === 'shop' ? [...base, String(d.bulk), String(d.bulkBig), money(d.shopBulk), money(d.shopTotal)] : [...base, String(d.bulk + d.bulkBig), money(P.partner_bulk_price), money(d.partnerBulk), money(d.partnerTotal)];
    });
    const sum = (f) => R.days.reduce((a, d) => a + f(d), 0);
    const totalRow = bulk ? (kind === 'shop' ? ['TỔNG', String(sum(d => d.normal)), '', money(sum(d => d.shopNormal)), String(sum(d => d.bulk)), String(sum(d => d.bulkBig)), money(sum(d => d.shopBulk)), money(R.totals.shop)] : ['TỔNG', String(sum(d => d.normal)), '', money(sum(d => d.partnerNormal)), String(sum(d => d.bulk + d.bulkBig)), '', money(sum(d => d.partnerBulk)), money(R.totals.partner)]) : ['TỔNG', String(sum(d => d.normal)), '', money(totalAmount(kind, R))];
    const cols = bulk
      ? [{ h: 'Ngày', w: 62, align: 'center' }, { h: 'Số đôi\n(đơn thường)', w: 58, align: 'right' }, { h: 'Đơn giá\n(đ/đôi)', w: 54, align: 'right' }, { h: 'Thành tiền', w: 72, align: 'right' }, { h: `Đôi trong đơn\nhơn ${P.bulk_min} đôi`, w: 62, align: 'right' }, { h: kind === 'shop' ? `Đôi trong đơn\nhơn ${P.shop_bulk_big_min} đôi` : 'Đơn giá\n(đ/đôi)', w: 62, align: 'right' }, { h: 'Thành tiền\nđơn nhiều đôi', w: 72, align: 'right' }, { h: 'Cộng trong\nngày', w: 76, align: 'right' }]
      : [{ h: 'Ngày', w: 110, align: 'center' }, { h: 'Số đôi giày đóng', w: 110, align: 'right' }, { h: 'Đơn giá (đ/đôi)', w: 110, align: 'right' }, { h: 'Thành tiền', w: 150, align: 'right' }];
    if (!R.days.length) { put('Không có đôi nào được đóng trong tháng này.', M, y, 10, font, MUT); y -= 20; } else table(cols, [...dayRows, totalRow], { totalLast: true });
    y -= 16; if (y < M + 130) newPage();
    put(`Tổng số đôi tính phí: ${money(R.totals.pairs)}`, M, y, 11, bold); y -= 20;
    put(`TỔNG TIỀN: ${money(totalAmount(kind, R))} đồng`, M, y, 14, bold, rgb(0.78, 0.16, 0.16)); y -= 22;
    put('Bảng giá áp dụng:', M, y, 9.5, bold, MUT); y -= 13;
    priceLines(kind, R).forEach(t => wrapLine(t, W - 2 * M, 9).forEach(l => { if (y < M + 40) newPage(); put(l, M, y, 9, font, MUT); y -= 12; }));
    y -= 8; put(`Người lập: ${P.issuer}  —  Ngày lập: ${dmy(today())}`, M, y, 9.5);
    if (opts.withList && R.rows.length) {
      newPage(); put('PHỤ LỤC: DANH SÁCH ĐƠN ĐÃ ĐÓNG', M, y - 12, 13, bold, BLUE); y -= 30;
      put(`Tháng ${R.month.slice(5)}/${R.month.slice(0, 4)} · ${R.rows.length} đôi`, M, y, 9.5, font, MUT); y -= 14;
      table([{ h: 'STT', w: 30, align: 'center' }, { h: 'Ngày', w: 56, align: 'center' }, { h: 'Mã đơn', w: 84 }, { h: 'Sản phẩm', w: 100 }, { h: 'Size', w: 32, align: 'center' }, { h: 'Màu', w: 70 }, { h: 'Đóng kèm', w: 90 }, { h: 'Trạng thái', w: 57 }],
        R.rows.map((r, i) => [i + 1, dmy(r.date).slice(0, 5), r.code || '—', r.product, r.size, r.color, r.kem || '', STATUS_TXT[r.status] || r.status]), { rowH: 15, headH: 22 });
    }
    const pages = doc.getPages();
    pages.forEach((p, i) => { const t = `Trang ${i + 1}/${pages.length}`; p.drawText(t, { x: W / 2 - font.widthOfTextAtSize(t, 8) / 2, y: 20, size: 8, font, color: MUT }); });
    return doc.save();
  }

  async function run(kind, fmt, R, opts = {}) {
    const name = fileName(kind, R.month, fmt === 'xlsx' ? 'xlsx' : 'pdf');
    const data = fmt === 'xlsx' ? await buildXlsx(kind, R, opts) : await buildPdf(kind, R, opts);
    download(new Blob([data], { type: fmt === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf' }), name);
    return name;
  }
  root.Export = { run, fileName, priceLines };
})(window);

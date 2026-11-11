/** Mẫu in: hóa đơn K80/K58/A5, tem sản phẩm, phiếu nhận sửa chữa, phiếu bảo hành */
import { barcodePng, barcodeSvg, escapeHtml as e, EscPosEncoder, mm, type PrintJob } from './printer';
import { date, dateTime, LABELS, money } from './format';

export type Paper = 'K80' | 'K58' | 'A5';
const PAPER_WIDTH_MM: Record<Paper, number> = { K80: 72, K58: 48, A5: 148 };

async function logoPng(url?: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    const scale = Math.min(1, 300 / img.width);
    c.width = img.width * scale; c.height = img.height * scale;
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } catch { return null; }
}

// =================================================================== HÓA ĐƠN
export function receiptJob(order: any, settings: Record<string, any>, paperOverride?: Paper, reprint = false): PrintJob {
  const store = settings.store ?? {};
  const inv = settings.invoice ?? {};
  const paper: Paper = paperOverride ?? inv.paper ?? 'K80';
  const width = PAPER_WIDTH_MM[paper];
  const small = paper === 'K58';
  const fs = small ? 10 : paper === 'A5' ? 11 : 11.5;
  const items: any[] = order.items ?? [];
  const pays: any[] = order.payments ?? [];
  const discount = Number(order.discount_amount) + Number(order.promotion_amount);
  const debt = Math.max(0, Number(order.total) - Number(order.refunded_amount || 0) - Number(order.paid_amount));
  const title = order.status === 'cancelled' ? 'HÓA ĐƠN (ĐÃ HỦY)' : 'HÓA ĐƠN BÁN HÀNG';

  const html = `<div class="r">
    ${inv.show_logo && store.logo ? `<div class="c"><img src="${e(store.logo)}" style="max-height:${small ? 40 : 56}px;max-width:70%"></div>` : ''}
    <div class="c store">${e(store.name)}</div>
    ${store.slogan ? `<div class="c muted">${e(store.slogan)}</div>` : ''}
    ${store.address ? `<div class="c">${e(store.address)}</div>` : ''}
    ${store.phone ? `<div class="c">ĐT: ${e(store.phone)}</div>` : ''}
    <div class="hr"></div>
    <div class="c title">${title}</div>
    ${reprint ? `<div class="c muted">(Bản in lại)</div>` : ''}
    <table class="meta"><tr><td>Số HĐ:</td><td class="rt"><b>${e(order.code)}</b></td></tr>
      <tr><td>Ngày:</td><td class="rt">${dateTime(order.created_at)}</td></tr>
      <tr><td>Thu ngân:</td><td class="rt">${e(order.created_by_name ?? '')}</td></tr>
      ${inv.show_customer && order.customer_name ? `<tr><td>Khách hàng:</td><td class="rt">${e(order.customer_name)}</td></tr>${order.customer_phone ? `<tr><td>SĐT:</td><td class="rt">${e(order.customer_phone)}</td></tr>` : ''}` : ''}
    </table>
    <div class="hr"></div>
    <table class="items">
      ${items.map((i, idx) => `<tr><td colspan="3"><b>${idx + 1}. ${e(i.product_name)}</b>${i.serial_number ? `<div class="muted">Serial: ${e(i.serial_number)}</div>` : ''}${i.sku ? `<div class="muted">SKU: ${e(i.sku)}</div>` : ''}</td></tr>
        <tr><td>${i.quantity} x ${money(i.unit_price, false)}</td><td class="rt">${Number(i.discount) ? '-' + money(i.discount, false) : ''}</td><td class="rt"><b>${money(i.line_total, false)}</b></td></tr>`).join('')}
    </table>
    <div class="hr"></div>
    <table class="sum">
      <tr><td>Tổng tiền hàng</td><td class="rt">${money(order.subtotal)}</td></tr>
      ${discount ? `<tr><td>Giảm giá${order.promotion_code ? ` (${e(order.promotion_code)})` : ''}</td><td class="rt">-${money(discount)}</td></tr>` : ''}
      <tr class="total"><td>TỔNG THANH TOÁN</td><td class="rt">${money(order.total)}</td></tr>
      ${pays.map((p) => `<tr><td>${LABELS.method[p.method]}</td><td class="rt">${money(p.amount)}</td></tr>`).join('')}
      ${Number(order.customer_given) > 0 && pays.some((p) => p.method === 'cash') ? `<tr><td>Tiền khách đưa</td><td class="rt">${money(order.customer_given)}</td></tr><tr><td>Tiền thừa</td><td class="rt">${money(order.change_amount)}</td></tr>` : ''}
      ${Number(order.refunded_amount) > 0 ? `<tr><td>Đã trả hàng</td><td class="rt">-${money(order.refunded_amount)}</td></tr>` : ''}
      ${debt > 0 ? `<tr><td><b>Còn nợ</b></td><td class="rt"><b>${money(debt)}</b></td></tr>` : ''}
    </table>
    ${inv.show_warranty && items.some((i) => i.serial_number && Number(i.warranty_months) > 0) ? `<div class="hr"></div><div class="muted">Bảo hành: ${items.filter((i) => i.serial_number && Number(i.warranty_months) > 0).map((i) => `${e(i.serial_number)} – ${i.warranty_months} tháng`).join('; ')}</div>` : ''}
    ${order.note ? `<div class="muted" style="margin-top:4px">Ghi chú: ${e(order.note)}</div>` : ''}
    ${store.bank_account ? `<div class="muted" style="margin-top:4px">CK: ${e(store.bank_name)} – ${e(store.bank_account)} – ${e(store.bank_owner)}</div>` : ''}
    ${inv.show_barcode ? `<div class="c" style="margin-top:6px">${barcodeSvg(order.code, 'CODE128', { height: small ? 28 : 34, width: small ? 1.2 : 1.4, fontSize: 10 })}</div>` : ''}
    ${inv.footer ? `<div class="c foot">${e(inv.footer).replace(/\n/g, '<br>')}</div>` : ''}
  </div>`;
  const pageCss = `@page{size:${paper === 'A5' ? 'A5' : `${width + 8}mm auto`};margin:${paper === 'A5' ? '10mm' : '2mm 4mm'}}
    .r{width:${width}mm;font-size:${fs}px;line-height:1.35;margin:0 auto}.c{text-align:center}.rt{text-align:right}.muted{color:#444;font-size:${fs - 1.5}px}
    .store{font-size:${fs + 4}px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}.title{font-size:${fs + 2}px;font-weight:700;margin:2px 0 4px}
    .hr{border-top:1px dashed #000;margin:5px 0}td{padding:1px 0;vertical-align:top}.items td{padding:1px 0}.total td{font-size:${fs + 2}px;font-weight:700;padding-top:3px}
    .foot{margin-top:8px;font-size:${fs - 1}px;font-style:italic}svg{max-width:100%}`;

  const pdf = async () => {
    const logo = inv.show_logo ? await logoPng(store.logo) : null;
    const W = mm(width);
    const line = { canvas: [{ type: 'line', x1: 0, y1: 0, x2: W, y2: 0, dash: { length: 2 }, lineWidth: 0.6 }], margin: [0, 4, 0, 4] };
    const row = (l: string, r: string, bold = false) => ({ columns: [{ text: l, bold }, { text: r, alignment: 'right', bold }], margin: [0, 1, 0, 1] });
    const content: any[] = [];
    if (logo) content.push({ image: logo, fit: [W * 0.6, 48], alignment: 'center', margin: [0, 0, 0, 4] });
    content.push({ text: (store.name ?? '').toUpperCase(), alignment: 'center', bold: true, fontSize: fs + 3 });
    if (store.slogan) content.push({ text: store.slogan, alignment: 'center', fontSize: fs - 1.5, color: '#444' });
    if (store.address) content.push({ text: store.address, alignment: 'center' });
    if (store.phone) content.push({ text: 'ĐT: ' + store.phone, alignment: 'center' });
    content.push(line, { text: title, alignment: 'center', bold: true, fontSize: fs + 1.5, margin: [0, 0, 0, 3] });
    if (reprint) content.push({ text: '(Bản in lại)', alignment: 'center', fontSize: fs - 1.5 });
    content.push(row('Số HĐ:', order.code, true), row('Ngày:', dateTime(order.created_at)), row('Thu ngân:', order.created_by_name ?? ''));
    if (inv.show_customer && order.customer_name) { content.push(row('Khách hàng:', order.customer_name)); if (order.customer_phone) content.push(row('SĐT:', order.customer_phone)); }
    content.push(line);
    items.forEach((i, idx) => {
      content.push({ text: `${idx + 1}. ${i.product_name}`, bold: true });
      if (i.serial_number) content.push({ text: 'Serial: ' + i.serial_number, fontSize: fs - 1.5, color: '#444' });
      content.push({ columns: [{ text: `${i.quantity} x ${money(i.unit_price, false)}` }, { text: Number(i.discount) ? '-' + money(i.discount, false) : '', alignment: 'right' }, { text: money(i.line_total, false), alignment: 'right', bold: true }], margin: [0, 0, 0, 3] });
    });
    content.push(line, row('Tổng tiền hàng', money(order.subtotal)));
    if (discount) content.push(row('Giảm giá', '-' + money(discount)));
    content.push({ ...row('TỔNG THANH TOÁN', money(order.total), true), fontSize: fs + 1.5 });
    pays.forEach((p) => content.push(row(LABELS.method[p.method], money(p.amount))));
    if (Number(order.customer_given) > 0 && pays.some((p) => p.method === 'cash')) content.push(row('Tiền khách đưa', money(order.customer_given)), row('Tiền thừa', money(order.change_amount)));
    if (Number(order.refunded_amount) > 0) content.push(row('Đã trả hàng', '-' + money(order.refunded_amount)));
    if (debt > 0) content.push(row('Còn nợ', money(debt), true));
    if (order.note) content.push({ text: 'Ghi chú: ' + order.note, fontSize: fs - 1.5, margin: [0, 3, 0, 0] });
    if (inv.show_barcode) content.push({ image: barcodePng(order.code, 'CODE128', { height: 40, fontSize: 14 }), fit: [W * 0.8, 40], alignment: 'center', margin: [0, 6, 0, 0] });
    if (inv.footer) content.push({ text: inv.footer, alignment: 'center', italics: true, fontSize: fs - 1, margin: [0, 6, 0, 0] });
    return {
      pageSize: paper === 'A5' ? 'A5' : { width: W + mm(8), height: 'auto' },
      pageMargins: paper === 'A5' ? [mm(12), mm(12), mm(12), mm(12)] : [mm(4), mm(4), mm(4), mm(6)],
      defaultStyle: { font: 'Roboto', fontSize: fs * 0.75 + 1 },
      content,
      info: { title: `Hoa don ${order.code}` },
    };
  };

  const escpos = () => {
    const p = new EscPosEncoder().init().align('center').bold(true).size(2, 2).line(store.name ?? '').size(1, 1).bold(false);
    if (store.address) p.line(store.address);
    if (store.phone) p.line('DT: ' + store.phone);
    p.line('-'.repeat(small ? 32 : 48)).bold(true).line(title).bold(false).align('left');
    p.line(`So HD: ${order.code}`).line(`Ngay: ${dateTime(order.created_at)}`);
    for (const i of items) p.line(i.product_name).line(`  ${i.quantity} x ${money(i.unit_price, false)} = ${money(i.line_total, false)}`);
    p.line('-'.repeat(small ? 32 : 48)).bold(true).line(`TONG: ${money(order.total)}`).bold(false).align('center').barcode128(order.code).newline(2).cut();
    return p.encode();
  };

  return { title: `Hóa đơn ${order.code}`, html, pageCss, pdf, escpos, fileName: `hoa-don-${order.code}.pdf` };
}

// =================================================================== TEM SẢN PHẨM
export interface LabelCfg {
  width_mm: number; height_mm: number; columns: number; gap_mm: number; font_size: number;
  show_brand: boolean; show_model: boolean; show_price: boolean; show_sku: boolean; show_barcode: boolean; show_name: boolean;
  layout?: 'a4' | 'roll';
}
export interface LabelItem { name: string; brand_name?: string | null; model?: string | null; sku: string; barcode: string; barcode_type: 'CODE128' | 'EAN13'; sale_price: number; promo_price?: number | null }

export function labelHtml(it: LabelItem, c: LabelCfg) {
  const price = it.promo_price && Number(it.promo_price) > 0 ? it.promo_price : it.sale_price;
  const bh = Math.max(8, c.height_mm * 0.34);
  return `<div class="lbl" style="width:${c.width_mm}mm;height:${c.height_mm}mm;font-size:${c.font_size}pt">
    ${c.show_brand && it.brand_name ? `<div class="b">${e(it.brand_name)}</div>` : ''}
    ${c.show_name ? `<div class="n">${e(it.name)}</div>` : ''}
    ${c.show_model && it.model ? `<div class="m">${e(it.model)}</div>` : ''}
    ${c.show_barcode ? `<div class="bc" style="height:${bh}mm">${barcodeSvg(it.barcode, it.barcode_type, { height: 40, width: 1.6, fontSize: 13, displayValue: true })}</div>` : ''}
    <div class="row">${c.show_sku ? `<span>${e(it.sku)}</span>` : '<span></span>'}${c.show_price ? `<b>${money(price)}</b>` : ''}</div>
  </div>`;
}
export const LABEL_CSS = `.lbl{border:0.2mm dashed #bbb;padding:1mm 1.5mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;line-height:1.15;font-family:Arial,sans-serif;color:#000;background:#fff;break-inside:avoid}
  .lbl .b{font-weight:700;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lbl .n,.lbl .m{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lbl .bc{display:flex;justify-content:center;align-items:center}.lbl .bc svg{height:100%;width:auto;max-width:100%}
  .lbl .row{display:flex;justify-content:space-between;gap:2mm;white-space:nowrap}`;

export function labelsJob(items: LabelItem[], c: LabelCfg): PrintJob {
  const roll = c.layout === 'roll';
  const html = roll
    ? items.map((it) => `<div class="page">${labelHtml(it, c)}</div>`).join('')
    : `<div class="grid">${items.map((it) => labelHtml(it, c)).join('')}</div>`;
  const pageCss = (roll
    ? `@page{size:${c.width_mm}mm ${c.height_mm}mm;margin:0}.page{page-break-after:always}.lbl{border:0}`
    : `@page{size:A4;margin:8mm}.grid{display:grid;grid-template-columns:repeat(${c.columns},${c.width_mm}mm);gap:${c.gap_mm}mm}`) + LABEL_CSS;

  const pdf = async () => {
    const W = mm(c.width_mm), H = mm(c.height_mm), gap = mm(c.gap_mm);
    const fs = c.font_size;
    const cell = (it: LabelItem) => {
      const price = it.promo_price && Number(it.promo_price) > 0 ? it.promo_price : it.sale_price;
      const stack: any[] = [];
      if (c.show_brand && it.brand_name) stack.push({ text: it.brand_name.toUpperCase(), bold: true, fontSize: fs });
      if (c.show_name) stack.push({ text: it.name, fontSize: fs - 1, maxHeight: fs * 1.3 });
      if (c.show_model && it.model) stack.push({ text: it.model, fontSize: fs - 1 });
      if (c.show_barcode) stack.push({ image: barcodePng(it.barcode, it.barcode_type, { height: 50, width: 2, fontSize: 16 }), fit: [W - mm(3), H * 0.42], alignment: 'center', margin: [0, 1, 0, 1] });
      stack.push({ columns: [{ text: c.show_sku ? it.sku : '', fontSize: fs - 1 }, { text: c.show_price ? money(price) : '', bold: true, alignment: 'right', fontSize: fs }] });
      return { stack, width: W, margin: [mm(1.5), mm(1), mm(1.5), 0] };
    };
    if (roll) {
      return {
        pageSize: { width: W, height: H }, pageMargins: [0, 0, 0, 0], defaultStyle: { font: 'Roboto' },
        content: items.map((it, i) => ({ ...cell(it), pageBreak: i < items.length - 1 ? 'after' : undefined, width: undefined })),
      };
    }
    const rows: any[][] = [];
    for (let i = 0; i < items.length; i += c.columns) {
      const r = items.slice(i, i + c.columns).map(cell);
      while (r.length < c.columns) r.push({ text: '' } as any);
      rows.push(r);
    }
    return {
      pageSize: 'A4', pageMargins: [mm(8), mm(8), mm(8), mm(8)], defaultStyle: { font: 'Roboto' },
      content: [{
        table: { widths: Array(c.columns).fill(W), heights: H, body: rows, dontBreakRows: true },
        layout: { hLineWidth: () => 0.3, vLineWidth: () => 0.3, hLineColor: () => '#cccccc', vLineColor: () => '#cccccc', paddingLeft: () => 0, paddingRight: () => gap, paddingTop: () => 0, paddingBottom: () => gap },
      }],
    };
  };
  return { title: 'In tem sản phẩm', html, pageCss, pdf, fileName: `tem-san-pham-${items.length}.pdf` };
}

// =================================================================== PHIẾU NHẬN SỬA CHỮA
export function repairTicketHtml(t: any, settings: Record<string, any>) {
  const s = settings.store ?? {};
  const copy = (label: string) => `<div class="sheet">
    <div class="hd"><div>${s.logo ? `<img src="${e(s.logo)}" style="max-height:40px">` : ''}<div class="sn">${e(s.name)}</div><div>${e(s.address ?? '')}</div><div>ĐT: ${e(s.phone ?? '')}</div></div>
      <div class="rt"><div class="tt">PHIẾU NHẬN ĐỒNG HỒ</div><div>Số phiếu: <b>${e(t.code)}</b></div><div>Ngày nhận: ${dateTime(t.received_at)}</div><div class="muted">${label}</div></div></div>
    <table class="kv">
      <tr><td>Khách hàng</td><td><b>${e(t.customer_name)}</b> – ${e(t.customer_phone ?? '')}</td></tr>
      <tr><td>Đồng hồ</td><td>${e([t.watch_brand, t.watch_model].filter(Boolean).join(' – '))}</td></tr>
      <tr><td>Serial</td><td>${e(t.serial_number ?? '—')}</td></tr>
      <tr><td>Tình trạng khi nhận</td><td>${e(t.receive_condition ?? '')}</td></tr>
      <tr><td>Phụ kiện kèm theo</td><td>${e(t.accessories ?? 'Không')}</td></tr>
      <tr><td>Yêu cầu / lỗi</td><td>${e(t.issue)}</td></tr>
      <tr><td>Loại dịch vụ</td><td>${t.is_warranty ? 'Bảo hành' : 'Sửa chữa có phí'}${t.warranty_code ? ` (BH: ${e(t.warranty_code)})` : ''}</td></tr>
      <tr><td>Chi phí dự kiến</td><td>${money(t.estimated_cost)}</td></tr>
      <tr><td>Đặt cọc</td><td>${money(t.deposit)}</td></tr>
      <tr><td>Hẹn trả</td><td>${date(t.expected_at)}</td></tr>
    </table>
    <div class="bc">${barcodeSvg(t.code, 'CODE128', { height: 30, width: 1.4, fontSize: 11 })}</div>
    <div class="note">Quý khách vui lòng mang theo phiếu này khi nhận lại đồng hồ. Cửa hàng không chịu trách nhiệm với đồng hồ không được nhận sau 90 ngày kể từ ngày hẹn trả.</div>
    <table class="sign"><tr><td>Khách hàng<br><br><br></td><td>Nhân viên tiếp nhận<br><br><br>${e(t.created_by_name ?? '')}</td></tr></table>
  </div>`;
  return {
    html: copy('Liên 1: Giao khách hàng') + '<div class="cut"></div>' + copy('Liên 2: Lưu cửa hàng'),
    pageCss: `@page{size:A4;margin:10mm}.sheet{font-size:12px;line-height:1.4;padding:4mm 0}.hd{display:flex;justify-content:space-between;gap:10mm}.sn{font-weight:700;font-size:15px;text-transform:uppercase}
      .rt{text-align:right}.tt{font-size:17px;font-weight:700}.muted{color:#555;font-style:italic}.kv{margin-top:4mm}.kv td{border:1px solid #999;padding:4px 6px;vertical-align:top}.kv td:first-child{width:38mm;background:#f3f3f3}
      .bc{text-align:center;margin-top:3mm}.note{font-size:10.5px;color:#444;margin-top:2mm}.sign td{text-align:center;padding-top:4mm;width:50%}.cut{border-top:1px dashed #000;margin:4mm 0}`,
  };
}

// =================================================================== PHIẾU BẢO HÀNH
export function warrantyCardHtml(w: any, settings: Record<string, any>) {
  const s = settings.store ?? {};
  return {
    html: `<div class="card">
      <div class="top">${s.logo ? `<img src="${e(s.logo)}" style="max-height:42px">` : ''}<div class="sn">${e(s.name)}</div><div class="sub">${e(s.address ?? '')} · ${e(s.phone ?? '')}</div></div>
      <div class="tt">PHIẾU BẢO HÀNH</div><div class="code">Mã bảo hành: <b>${e(w.code)}</b></div>
      <table class="kv">
        <tr><td>Sản phẩm</td><td><b>${e(w.product_name)}</b></td></tr>
        ${w.brand_name ? `<tr><td>Thương hiệu / Ref</td><td>${e(w.brand_name)}${w.reference_number ? ' / ' + e(w.reference_number) : ''}</td></tr>` : ''}
        <tr><td>Serial Number</td><td><b>${e(w.serial_number)}</b></td></tr>
        ${w.movement_number ? `<tr><td>Movement No.</td><td>${e(w.movement_number)}</td></tr>` : ''}
        <tr><td>Khách hàng</td><td>${e(w.customer_name ?? '')} ${w.customer_phone ? '– ' + e(w.customer_phone) : ''}</td></tr>
        <tr><td>Hóa đơn</td><td>${e(w.order_code ?? '—')}</td></tr>
        <tr><td>Thời hạn</td><td>Từ <b>${date(w.start_date)}</b> đến <b>${date(w.end_date)}</b></td></tr>
      </table>
      <div class="terms"><b>Điều kiện bảo hành:</b><br>${e(w.terms || 'Bảo hành lỗi kỹ thuật bộ máy do nhà sản xuất. Không bảo hành: vỡ kính, móp vỏ, dây, vào nước do sử dụng sai cách, tự ý tháo mở, rơi va đập.')}</div>
      <div class="bc">${barcodeSvg(w.code, 'CODE128', { height: 30, width: 1.4, fontSize: 11 })}</div>
    </div>`,
    pageCss: `@page{size:A5;margin:10mm}.card{border:1.5px solid #9a7b43;border-radius:6px;padding:7mm;font-size:12px;line-height:1.45}.top{text-align:center}
      .sn{font-size:18px;font-weight:700;letter-spacing:1px;text-transform:uppercase}.sub{color:#555;font-size:11px}.tt{text-align:center;font-size:20px;font-weight:700;margin:5mm 0 1mm;color:#7a6135;letter-spacing:2px}
      .code{text-align:center;margin-bottom:4mm}.kv td{border-bottom:1px solid #ddd;padding:5px 4px;vertical-align:top}.kv td:first-child{width:36mm;color:#555}.terms{margin-top:4mm;font-size:10.5px;color:#333}.bc{text-align:center;margin-top:4mm}`,
  };
}

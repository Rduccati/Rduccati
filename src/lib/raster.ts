/**
 * Dựng hóa đơn / tem thành ẢNH 1-bit (raster) để gửi thẳng tới máy in nhiệt.
 * Ưu điểm: hiển thị đầy đủ tiếng Việt (font máy tính), không phụ thuộc bảng mã của máy in.
 *   - Hóa đơn → ESC/POS "GS v 0" (iMin M2 Pro 58mm, Xprinter bill 80mm...)
 *   - Tem     → TSPL "BITMAP" (Xprinter XP-350B / X350B, TSC... 203 DPI)
 */
import JsBarcode from 'jsbarcode';
import { dateTime, LABELS, money } from './format';
import type { LabelCfg, LabelItem } from './documents';

export interface MonoBitmap { width: number; height: number; /** 1 = chấm đen */ data: Uint8Array }

const FONT = `'Roboto','Segoe UI',Arial,sans-serif`;

/** Chuyển canvas → bitmap 1-bit (ngưỡng độ sáng) */
export function toMono(canvas: HTMLCanvasElement, height = canvas.height, threshold = 160): MonoBitmap {
  const w = canvas.width;
  const img = canvas.getContext('2d')!.getImageData(0, 0, w, height).data;
  const data = new Uint8Array(w * height);
  for (let i = 0; i < w * height; i++) {
    const a = img[i * 4 + 3] / 255;
    const lum = (img[i * 4] * 0.299 + img[i * 4 + 1] * 0.587 + img[i * 4 + 2] * 0.114) * a + 255 * (1 - a);
    data[i] = lum < threshold ? 1 : 0;
  }
  return { width: w, height, data };
}

/** Vẽ barcode với độ rộng module là số nguyên chấm in → vạch sắc nét */
function barcodeCanvas(code: string, format: 'CODE128' | 'EAN13', maxWidth: number, height: number, fontSize: number) {
  const make = (w: number, fmt: string) => {
    const c = document.createElement('canvas');
    JsBarcode(c, code, { format: fmt, width: w, height, displayValue: true, fontSize, margin: 0, textMargin: 1, background: '#ffffff', font: 'Arial' });
    return c;
  };
  let fmt: string = format;
  let probe: HTMLCanvasElement;
  try { probe = make(1, fmt); } catch { fmt = 'CODE128'; probe = make(1, fmt); }
  const module = Math.max(1, Math.min(4, Math.floor(maxWidth / probe.width)));
  return module === 1 ? probe : make(module, fmt);
}

/** Bút vẽ theo dòng, tự xuống dòng */
class Pen {
  y = 0;
  ctx: CanvasRenderingContext2D;
  constructor(public canvas: HTMLCanvasElement, public width: number, public base: number) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.ctx.fillStyle = '#000';
    this.ctx.textBaseline = 'top';
  }
  font(size: number, bold = false) { this.ctx.font = `${bold ? '700' : '400'} ${Math.round(size)}px ${FONT}`; }
  wrap(text: string, maxW: number) {
    const out: string[] = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const t = line ? line + ' ' + word : word;
        if (this.ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  }
  text(text: string, o: { size?: number; bold?: boolean; align?: 'left' | 'center' | 'right' } = {}) {
    const size = o.size ?? this.base;
    this.font(size, o.bold);
    for (const l of this.wrap(text, this.width)) {
      const w = this.ctx.measureText(l).width;
      const x = o.align === 'center' ? (this.width - w) / 2 : o.align === 'right' ? this.width - w : 0;
      this.ctx.fillText(l, x, this.y);
      this.y += Math.round(size * 1.28);
    }
  }
  row(left: string, right: string, o: { size?: number; bold?: boolean } = {}) {
    const size = o.size ?? this.base;
    this.font(size, o.bold);
    const rw = this.ctx.measureText(right).width;
    const lines = this.wrap(left, this.width - rw - size);
    lines.forEach((l, i) => {
      this.ctx.fillText(l, 0, this.y);
      if (i === 0) this.ctx.fillText(right, this.width - rw, this.y);
      this.y += Math.round(size * 1.28);
    });
  }
  hr(dashed = true) {
    this.y += 4;
    for (let x = 0; x < this.width; x += dashed ? 8 : 1) this.ctx.fillRect(x, this.y, dashed ? 5 : 1, 2);
    this.y += 8;
  }
  gap(n: number) { this.y += n; }
  image(img: CanvasImageSource, w: number, h: number) {
    this.ctx.drawImage(img, Math.round((this.width - w) / 2), this.y, w, h);
    this.y += h;
  }
}

async function loadImage(url?: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  try { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode(); return img; } catch { return null; }
}

/** Hóa đơn → bitmap. widthDots: 384 (58mm) | 576 (80mm) */
export async function renderReceipt(order: any, settings: Record<string, any>, widthDots: number, reprint = false): Promise<MonoBitmap> {
  const store = settings.store ?? {};
  const inv = settings.invoice ?? {};
  const canvas = document.createElement('canvas');
  canvas.width = widthDots;
  canvas.height = 6000;
  const base = widthDots <= 384 ? 22 : 26;
  const p = new Pen(canvas, widthDots, base);
  const items: any[] = order.items ?? [];
  const pays: any[] = order.payments ?? [];
  const discount = Number(order.discount_amount) + Number(order.promotion_amount);
  const debt = Math.max(0, Number(order.total) - Number(order.refunded_amount || 0) - Number(order.paid_amount));

  if (inv.show_logo && store.logo) {
    const img = await loadImage(store.logo);
    if (img) { const h = Math.min(110, Math.round(img.height * Math.min(1, (widthDots * 0.55) / img.width))); p.image(img, Math.round(img.width * (h / img.height)), h); p.gap(6); }
  }
  p.text(String(store.name ?? '').toUpperCase(), { size: base * 1.35, bold: true, align: 'center' });
  if (store.slogan) p.text(store.slogan, { size: base * 0.85, align: 'center' });
  if (store.address) p.text(store.address, { size: base * 0.85, align: 'center' });
  if (store.phone) p.text('ĐT: ' + store.phone, { size: base * 0.85, align: 'center' });
  p.hr();
  p.text(order.status === 'cancelled' ? 'HÓA ĐƠN (ĐÃ HỦY)' : 'HÓA ĐƠN BÁN HÀNG', { size: base * 1.2, bold: true, align: 'center' });
  if (reprint) p.text('(Bản in lại)', { size: base * 0.85, align: 'center' });
  p.gap(4);
  p.row('Số HĐ:', order.code, { bold: true });
  p.row('Ngày:', dateTime(order.created_at));
  if (order.created_by_name) p.row('Thu ngân:', order.created_by_name);
  if (inv.show_customer && order.customer_name) { p.row('Khách:', order.customer_name); if (order.customer_phone) p.row('SĐT:', order.customer_phone); }
  p.hr();
  items.forEach((i, idx) => {
    p.text(`${idx + 1}. ${i.product_name}`, { bold: true });
    if (i.serial_number) p.text('Serial: ' + i.serial_number, { size: base * 0.85 });
    p.row(`${i.quantity} x ${money(i.unit_price, false)}${Number(i.discount) ? ` (-${money(i.discount, false)})` : ''}`, money(i.line_total, false), { bold: false });
    p.gap(4);
  });
  p.hr();
  p.row('Tổng tiền hàng', money(order.subtotal));
  if (discount) p.row('Giảm giá', '-' + money(discount));
  p.row('TỔNG CỘNG', money(order.total), { size: base * 1.25, bold: true });
  pays.forEach((x) => p.row(LABELS.method[x.method] ?? x.method, money(x.amount)));
  if (Number(order.customer_given) > 0 && pays.some((x) => x.method === 'cash')) { p.row('Khách đưa', money(order.customer_given)); p.row('Tiền thừa', money(order.change_amount)); }
  if (Number(order.refunded_amount) > 0) p.row('Đã trả hàng', '-' + money(order.refunded_amount));
  if (debt > 0) p.row('Còn nợ', money(debt), { bold: true });
  const warr = items.filter((i) => i.serial_number && Number(i.warranty_months) > 0);
  if (inv.show_warranty && warr.length) { p.hr(); warr.forEach((i) => p.text(`Bảo hành ${i.warranty_months} tháng – SN ${i.serial_number}`, { size: base * 0.85 })); }
  if (order.note) p.text('Ghi chú: ' + order.note, { size: base * 0.85 });
  if (store.bank_account) p.text(`CK: ${store.bank_name ?? ''} ${store.bank_account} ${store.bank_owner ?? ''}`, { size: base * 0.85 });
  if (inv.show_barcode) {
    p.gap(10);
    const bc = barcodeCanvas(order.code, 'CODE128', widthDots * 0.9, 60, 20);
    p.image(bc, bc.width, bc.height);
  }
  if (inv.footer) { p.gap(10); p.text(inv.footer, { size: base * 0.85, align: 'center' }); }
  p.gap(16);
  return toMono(canvas, Math.ceil(p.y / 8) * 8);
}

/** Tem sản phẩm → bitmap theo đúng kích thước tem (8 chấm/mm @203 DPI) */
export function renderLabel(it: LabelItem, c: LabelCfg, dotsPerMm = 8): MonoBitmap {
  const W = Math.round(c.width_mm * dotsPerMm);
  const H = Math.round(c.height_mm * dotsPerMm);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(W / 8) * 8;
  canvas.height = H;
  const pad = Math.round(1.5 * dotsPerMm);
  const p = new Pen(canvas, W - pad * 2, Math.round(c.font_size * dotsPerMm * 0.36));
  p.ctx.translate(pad, 0);
  p.y = Math.round(dotsPerMm * 0.8);
  const fs = p.base;
  const price = it.promo_price && Number(it.promo_price) > 0 ? it.promo_price : it.sale_price;
  const one = (s: string, size: number, bold = false) => { p.font(size, bold); let t = s; while (p.ctx.measureText(t).width > p.width && t.length > 3) t = t.slice(0, -2) + '…'; p.ctx.fillText(t, 0, p.y); p.y += Math.round(size * 1.18); };
  if (c.show_brand && it.brand_name) one(it.brand_name.toUpperCase(), fs * 1.1, true);
  if (c.show_name) one(it.name, fs * 0.95);
  if (c.show_model && it.model) one(it.model, fs * 0.95);
  const footer = Math.round(fs * 1.3);
  if (c.show_barcode) {
    const avail = H - p.y - footer - 4;
    if (avail > 30) {
      const bc = barcodeCanvas(it.barcode, it.barcode_type, p.width, Math.max(20, avail - Math.round(fs * 1.1)), Math.max(14, Math.round(fs * 0.85)));
      const h = Math.min(bc.height, avail);
      p.ctx.drawImage(bc, Math.round((p.width - bc.width) / 2), p.y, bc.width, h);
    }
  }
  p.font(fs, false);
  p.y = H - footer;
  if (c.show_sku) p.ctx.fillText(it.sku, 0, p.y);
  if (c.show_price) { p.font(fs * 1.05, true); const t = money(price); p.ctx.fillText(t, p.width - p.ctx.measureText(t).width, p.y); }
  return toMono(canvas);
}

// ============================================================ Bộ mã hóa lệnh
const ascii = (s: string) => new TextEncoder().encode(s);
function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function packRows(bmp: MonoBitmap, y0: number, rows: number, invert: boolean) {
  const wb = Math.ceil(bmp.width / 8);
  const out = new Uint8Array(wb * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < bmp.width; x++) {
    const black = bmp.data[(y0 + y) * bmp.width + x] === 1;
    if (black !== invert) out[y * wb + (x >> 3)] |= 0x80 >> (x & 7);
  }
  if (invert && bmp.width % 8) for (let y = 0; y < rows; y++) out[y * wb + wb - 1] |= (1 << (8 - (bmp.width % 8))) - 1;
  return out;
}

/** ESC/POS: in ảnh raster (GS v 0), chia dải 128 dòng để tránh tràn bộ đệm */
export function escposRaster(bmp: MonoBitmap, opts: { cut?: boolean; feed?: number; drawer?: boolean } = {}) {
  const wb = Math.ceil(bmp.width / 8);
  const parts: Uint8Array[] = [new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x00])];
  for (let y = 0; y < bmp.height; y += 128) {
    const rows = Math.min(128, bmp.height - y);
    parts.push(new Uint8Array([0x1d, 0x76, 0x30, 0x00, wb & 0xff, wb >> 8, rows & 0xff, rows >> 8]), packRows(bmp, y, rows, false));
  }
  parts.push(new Uint8Array(Array(opts.feed ?? 4).fill(0x0a)));
  if (opts.drawer) parts.push(new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  if (opts.cut) parts.push(new Uint8Array([0x1d, 0x56, 0x42, 0x00]));
  return concat(parts);
}

export interface TsplOpts { width_mm: number; height_mm: number; gap_mm: number; density: number; speed: number; direction: 0 | 1; invert: boolean; offset_x?: number }
/** TSPL: mỗi tem 1 lệnh BITMAP + PRINT. invert=false: bit 1 = không in (trắng) – mặc định của TSPL */
export function tsplLabels(labels: { bmp: MonoBitmap; copies: number }[], o: TsplOpts) {
  const parts: Uint8Array[] = [ascii(`SIZE ${o.width_mm} mm,${o.height_mm} mm\r\nGAP ${o.gap_mm} mm,0 mm\r\nDIRECTION ${o.direction}\r\nREFERENCE 0,0\r\nDENSITY ${o.density}\r\nSPEED ${o.speed}\r\nSET TEAR ON\r\n`)];
  for (const l of labels) {
    const wb = Math.ceil(l.bmp.width / 8);
    // TSPL mặc định: bit 0 = in (đen), bit 1 = không in → đảo so với ESC/POS
    const data = packRows(l.bmp, 0, l.bmp.height, !o.invert);
    parts.push(ascii(`CLS\r\nBITMAP ${o.offset_x ?? 0},0,${wb},${l.bmp.height},0,`), data, ascii(`\r\nPRINT 1,${Math.max(1, l.copies)}\r\n`));
  }
  return concat(parts);
}

export function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Xem trước bitmap (để kiểm tra trước khi in) */
export function monoToDataUrl(bmp: MonoBitmap) {
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(bmp.width, bmp.height);
  for (let i = 0; i < bmp.data.length; i++) { const v = bmp.data[i] ? 0 : 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * PRINTER SERVICE – lớp in ấn độc lập với phần cứng.
 *
 * Giai đoạn 1 (hiện tại): in qua trình duyệt (Print Preview) và xuất PDF.
 * Giai đoạn sau: bổ sung driver ESC/POS qua USB / LAN / Wi-Fi / Bluetooth bằng cách
 * hiện thực interface PrinterTransport và đăng ký vào EscPosDriver – không cần sửa màn hình bán hàng.
 */
import JsBarcode from 'jsbarcode';

// ------------------------------------------------------------------ Barcode
export function barcodeSvg(code: string, format: 'CODE128' | 'EAN13' = 'CODE128', opts: { height?: number; width?: number; fontSize?: number; displayValue?: boolean } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, code, { format, height: opts.height ?? 40, width: opts.width ?? 1.6, fontSize: opts.fontSize ?? 12, displayValue: opts.displayValue ?? true, margin: 0, background: 'transparent' });
  } catch {
    JsBarcode(svg, code, { format: 'CODE128', height: opts.height ?? 40, width: opts.width ?? 1.6, fontSize: opts.fontSize ?? 12, displayValue: opts.displayValue ?? true, margin: 0, background: 'transparent' });
  }
  return svg.outerHTML;
}
export function barcodePng(code: string, format: 'CODE128' | 'EAN13' = 'CODE128', opts: { height?: number; width?: number; fontSize?: number; displayValue?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  const o = { height: opts.height ?? 60, width: opts.width ?? 2, fontSize: opts.fontSize ?? 16, displayValue: opts.displayValue ?? true, margin: 4, background: '#ffffff' };
  try { JsBarcode(canvas, code, { format, ...o }); } catch { JsBarcode(canvas, code, { format: 'CODE128', ...o }); }
  return canvas.toDataURL('image/png');
}

// ------------------------------------------------------------------ PDF (pdfmake, font Roboto hỗ trợ tiếng Việt)
let pdfMakePromise: Promise<any> | null = null;
export function getPdfMake() {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      const pm: any = await import('pdfmake/build/pdfmake');
      const vf: any = await import('pdfmake/build/vfs_fonts');
      const pdfMake = pm.default ?? pm;
      const vfsMod = vf.default ?? vf;
      pdfMake.vfs = vfsMod.pdfMake?.vfs ?? vfsMod.vfs ?? vfsMod;
      return pdfMake;
    })();
  }
  return pdfMakePromise;
}
export const mm = (v: number) => (v * 72) / 25.4;

// ------------------------------------------------------------------ In HTML qua iframe ẩn (Print Preview của trình duyệt)
export function printHtml(html: string, opts: { pageCss?: string; title?: string } = {}) {
  return new Promise<void>((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${opts.title ?? 'WATCH POS'}</title>
      <style>${BASE_PRINT_CSS}${opts.pageCss ?? ''}</style></head><body>${html}</body></html>`);
    doc.close();
    const go = () => {
      iframe.contentWindow!.focus();
      iframe.contentWindow!.print();
      setTimeout(() => { iframe.remove(); resolve(); }, 1500);
    };
    const imgs = Array.from(doc.images);
    if (!imgs.length) setTimeout(go, 150);
    else Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })))).then(() => setTimeout(go, 100));
  });
}
const BASE_PRINT_CSS = `*{box-sizing:border-box}body{margin:0;font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table{border-collapse:collapse;width:100%}`;

// ------------------------------------------------------------------ ESC/POS encoder (sẵn sàng cho giai đoạn sau)
export class EscPosEncoder {
  private bytes: number[] = [];
  private enc = new TextEncoder();
  init() { this.bytes.push(0x1b, 0x40); return this; }
  align(a: 'left' | 'center' | 'right') { this.bytes.push(0x1b, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); return this; }
  bold(on: boolean) { this.bytes.push(0x1b, 0x45, on ? 1 : 0); return this; }
  size(w: 1 | 2, h: 1 | 2) { this.bytes.push(0x1d, 0x21, ((w - 1) << 4) | (h - 1)); return this; }
  /** Lưu ý: máy in nhiệt thường không có font tiếng Việt – sẽ bỏ dấu khi cần */
  text(s: string, stripAccents = true) {
    const t = stripAccents ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D') : s;
    this.bytes.push(...this.enc.encode(t));
    return this;
  }
  line(s = '') { return this.text(s).newline(); }
  newline(n = 1) { for (let i = 0; i < n; i++) this.bytes.push(0x0a); return this; }
  barcode128(data: string, height = 60) {
    const d = this.enc.encode('{B' + data);
    this.bytes.push(0x1d, 0x68, height, 0x1d, 0x77, 2, 0x1d, 0x48, 2, 0x1d, 0x6b, 73, d.length, ...d);
    return this;
  }
  cut() { this.bytes.push(0x1d, 0x56, 0x42, 0x00); return this; }
  openCashDrawer() { this.bytes.push(0x1b, 0x70, 0x00, 0x19, 0xfa); return this; }
  encode() { return new Uint8Array(this.bytes); }
}

/** Kênh truyền tới máy in thật – hiện thực ở giai đoạn sau (WebUSB, WebSerial, TCP 9100 qua server, Bluetooth) */
export interface PrinterTransport {
  kind: 'usb' | 'lan' | 'wifi' | 'bluetooth';
  connect(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
}

// ------------------------------------------------------------------ Drivers
export interface PrintJob {
  title: string;
  html: string;
  pageCss: string;
  pdf: () => Promise<any>; // định nghĩa tài liệu pdfmake
  escpos?: () => Uint8Array;
  fileName: string;
}
export interface PrinterDriver {
  id: 'browser' | 'pdf' | 'escpos';
  label: string;
  ready: boolean;
  print(job: PrintJob): Promise<void>;
}

const browserDriver: PrinterDriver = {
  id: 'browser', label: 'In qua trình duyệt (Print Preview)', ready: true,
  print: (job) => printHtml(job.html, { pageCss: job.pageCss, title: job.title }),
};
const pdfDriver: PrinterDriver = {
  id: 'pdf', label: 'Mở file PDF', ready: true,
  print: async (job) => {
    const pdfMake = await getPdfMake();
    pdfMake.createPdf(await job.pdf()).open();
  },
};
let escposTransport: PrinterTransport | null = null;
export function registerEscPosTransport(t: PrinterTransport | null) { escposTransport = t; }
const escposDriver: PrinterDriver = {
  id: 'escpos', label: 'Máy in nhiệt ESC/POS (USB/LAN/Wi-Fi/Bluetooth)', get ready() { return !!escposTransport; },
  print: async (job) => {
    if (!escposTransport) throw new Error('Chưa kết nối máy in ESC/POS. Vào Cài đặt → Máy in để chọn "In qua trình duyệt" trong giai đoạn này.');
    if (!job.escpos) throw new Error('Mẫu in này chưa hỗ trợ ESC/POS');
    await escposTransport.connect();
    await escposTransport.write(job.escpos());
  },
};

export const printerService = {
  drivers: [browserDriver, pdfDriver, escposDriver],
  async print(job: PrintJob, driverId: string = 'browser') {
    const d = this.drivers.find((x) => x.id === driverId) ?? browserDriver;
    if (!d.ready) return browserDriver.print(job); // tự động quay về in trình duyệt
    return d.print(job);
  },
  async downloadPdf(job: PrintJob) {
    const pdfMake = await getPdfMake();
    pdfMake.createPdf(await job.pdf()).download(job.fileName);
  },
  async previewPdf(job: PrintJob) {
    const pdfMake = await getPdfMake();
    pdfMake.createPdf(await job.pdf()).open();
  },
};

export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Tải ảnh (logo) thành dataURL để nhúng vào PDF */
export async function imageToDataUrl(url?: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
  } catch { return null; }
}

/**
 * Cấu hình in THEO TỪNG THIẾT BỊ (lưu trên trình duyệt của máy đó):
 *  - Máy tính quầy: in tem qua Xprinter X350B (USB) → "server" (TSPL RAW qua Windows)
 *  - iMin M2 Pro (Android): in bill máy in tích hợp 58mm → "rawbt" (ESC/POS ảnh qua app RawBT) hoặc "browser"
 */
import { api } from './api';
import { receiptJob, labelsJob, type LabelCfg, type LabelItem, type Paper } from './documents';
import { printerService } from './printer';
import { escposRaster, renderLabel, renderReceipt, toBase64, tsplLabels } from './raster';

export type ReceiptMethod = 'browser' | 'pdf' | 'rawbt' | 'server';
export type LabelMethod = 'browser' | 'pdf' | 'server';
export interface DevicePrintCfg {
  receipt: { method: ReceiptMethod; paper: Paper; printer: string; cut: boolean; drawer: boolean; auto: boolean };
  label: { method: LabelMethod; printer: string; gap_mm: number; density: number; speed: number; direction: 0 | 1; invert: boolean; offset_x: number };
}

const KEY = 'watchpos_device_print';
const isAndroid = () => /Android/i.test(navigator.userAgent);

export function defaultDeviceCfg(settings: Record<string, any>): DevicePrintCfg {
  return {
    receipt: { method: isAndroid() ? 'rawbt' : 'browser', paper: isAndroid() ? 'K58' : (settings.invoice?.paper ?? 'K80'), printer: '', cut: false, drawer: false, auto: !!settings.printer?.auto_print_after_sale },
    label: { method: 'browser', printer: '', gap_mm: 2, density: 10, speed: 4, direction: 1, invert: false, offset_x: 0 },
  };
}
export function loadDeviceCfg(settings: Record<string, any>): DevicePrintCfg {
  const d = defaultDeviceCfg(settings);
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) return { receipt: { ...d.receipt, ...s.receipt }, label: { ...d.label, ...s.label } };
  } catch { /* ignore */ }
  return d;
}
export function saveDeviceCfg(c: DevicePrintCfg) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export const RECEIPT_METHODS: { value: ReceiptMethod; label: string; hint: string }[] = [
  { value: 'browser', label: 'Hộp thoại in của trình duyệt', hint: 'Dùng driver máy in của Windows/Android. Chọn khổ giấy đúng và lề = Không.' },
  { value: 'rawbt', label: 'Android: gửi sang app RawBT (ESC/POS)', hint: 'Cho máy POS Android có máy in tích hợp (iMin M2 Pro...). Cần cài app RawBT và chọn máy in tích hợp trong RawBT.' },
  { value: 'server', label: 'Máy in nối với máy tính chủ (in thẳng ESC/POS)', hint: 'Máy in bill cắm USB vào máy tính chạy WATCH POS. In ngay, không hiện hộp thoại.' },
  { value: 'pdf', label: 'Mở file PDF', hint: 'Dự phòng khi chưa có máy in.' },
];
export const LABEL_METHODS: { value: LabelMethod; label: string; hint: string }[] = [
  { value: 'server', label: 'In thẳng TSPL qua máy tính chủ (khuyên dùng cho X350B)', hint: 'Máy tem cắm USB vào máy tính chạy WATCH POS, đã cài driver. In ngay, tem đúng kích thước, mã vạch sắc nét.' },
  { value: 'browser', label: 'Hộp thoại in của trình duyệt (qua driver)', hint: 'Cần tạo khổ giấy đúng kích thước tem trong driver, chọn "Cuộn tem" ở trang In tem.' },
  { value: 'pdf', label: 'Xuất PDF', hint: 'In thử trên giấy A4.' },
];

const receiptWidth = (paper: Paper) => (paper === 'K80' ? 576 : 384);

/** Gửi dữ liệu ESC/POS sang app RawBT trên Android */
export function sendToRawBT(bytes: Uint8Array) {
  if (!isAndroid()) throw new Error('RawBT chỉ dùng trên thiết bị Android (VD: iMin M2 Pro). Trên máy tính hãy chọn cách in khác.');
  window.location.href = `intent:base64,${toBase64(bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

export async function sendToServerPrinter(printer: string, bytes: Uint8Array, kind: 'receipt' | 'label' | 'test', ref?: string) {
  if (!printer) throw new Error('Chưa chọn máy in. Vào Cài đặt → Máy in trên thiết bị này để chọn.');
  return api.post('/printing/raw', { printer, data: toBase64(bytes), kind, ref });
}

export async function printReceiptDevice(order: any, settings: Record<string, any>, opts: { paper?: Paper; reprint?: boolean; cfg?: DevicePrintCfg } = {}) {
  const cfg = (opts.cfg ?? loadDeviceCfg(settings)).receipt;
  const paper = opts.paper ?? cfg.paper;
  switch (cfg.method) {
    case 'pdf': return printerService.previewPdf(receiptJob(order, settings, paper, opts.reprint));
    case 'rawbt': {
      const bmp = await renderReceipt(order, settings, receiptWidth(paper), opts.reprint);
      return sendToRawBT(escposRaster(bmp, { cut: cfg.cut, drawer: cfg.drawer }));
    }
    case 'server': {
      const bmp = await renderReceipt(order, settings, receiptWidth(paper), opts.reprint);
      await sendToServerPrinter(cfg.printer, escposRaster(bmp, { cut: cfg.cut, drawer: cfg.drawer }), 'receipt', order.code);
      return;
    }
    default: return printerService.print(receiptJob(order, settings, paper, opts.reprint), 'browser');
  }
}

/** items: mỗi phần tử kèm số bản in */
export async function printLabelsDevice(items: (LabelItem & { copies: number })[], labelCfg: LabelCfg, settings: Record<string, any>, method?: LabelMethod) {
  const cfg = loadDeviceCfg(settings).label;
  const m = method ?? cfg.method;
  const expanded = items.flatMap((it) => Array.from({ length: Math.max(0, it.copies) }, () => it));
  if (!expanded.length) throw new Error('Chưa có tem để in');
  if (m === 'pdf') return printerService.downloadPdf(labelsJob(expanded, labelCfg));
  if (m === 'browser') return printerService.print(labelsJob(expanded, labelCfg), 'browser');
  const data = tsplLabels(items.filter((i) => i.copies > 0).map((it) => ({ bmp: renderLabel(it, labelCfg), copies: it.copies })), {
    width_mm: labelCfg.width_mm, height_mm: labelCfg.height_mm, gap_mm: cfg.gap_mm, density: cfg.density, speed: cfg.speed, direction: cfg.direction, invert: cfg.invert, offset_x: cfg.offset_x,
  });
  await sendToServerPrinter(cfg.printer, data, 'label', `${expanded.length} tem`);
}

export const SAMPLE_ORDER = {
  id: 0, code: 'DH-TEST01', created_at: new Date().toISOString(), created_by_name: 'In thử', customer_name: 'Khách hàng mẫu', customer_phone: '0900000000',
  subtotal: 12580000, discount_amount: 80000, promotion_amount: 0, total: 12500000, paid_amount: 12500000, customer_given: 12500000, change_amount: 0, refunded_amount: 0, status: 'completed', note: 'Kiểm tra tiếng Việt: ăâđêôơư ẮẰẲẴẶ',
  items: [{ product_name: 'Seiko Presage Cocktail Time', sku: 'SEI-0001', serial_number: 'SN123456', quantity: 1, unit_price: 12500000, discount: 0, line_total: 12500000, warranty_months: 12 },
    { product_name: 'Pin đồng hồ Renata 371', sku: 'PK-0003', serial_number: null, quantity: 1, unit_price: 80000, discount: 0, line_total: 80000, warranty_months: 0 }],
  payments: [{ method: 'cash', amount: 12500000 }],
};
export const SAMPLE_LABEL: LabelItem = { name: 'Seiko Presage Cocktail Time', brand_name: 'Seiko', model: 'Presage SRPB43J1', sku: 'SEI-0001', barcode: '2000000000015', barcode_type: 'EAN13', sale_price: 12500000 };

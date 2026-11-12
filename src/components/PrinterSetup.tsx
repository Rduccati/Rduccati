import { useEffect, useState } from 'react';
import { Printer, RefreshCw, Save, Tag, Receipt, Info } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  defaultDeviceCfg, LABEL_METHODS, loadDeviceCfg, printLabelsDevice, printReceiptDevice, RECEIPT_METHODS, SAMPLE_LABEL, SAMPLE_ORDER, saveDeviceCfg,
  sendToRawBT, sendToServerPrinter, type DevicePrintCfg,
} from '../lib/devicePrint';
import { monoToDataUrl, renderLabel, renderReceipt, tsplLabels } from '../lib/raster';
import type { LabelCfg } from '../lib/documents';
import { Field, Select, Toggle, cx, useUi } from './ui';

/** Cài đặt máy in cho THIẾT BỊ ĐANG DÙNG + in thử */
export default function PrinterSetup() {
  const { settings } = useAuth();
  const { toast } = useUi();
  const [cfg, setCfg] = useState<DevicePrintCfg>(() => loadDeviceCfg(settings));
  const [printers, setPrinters] = useState<{ printers: string[]; platform?: string; host?: string; error?: string } | null>(null);
  const [loadingP, setLoadingP] = useState(false);
  const [preview, setPreview] = useState<{ receipt?: string; label?: string }>({});
  const [busy, setBusy] = useState(false);
  const labelCfg: LabelCfg = { width_mm: 50, height_mm: 30, columns: 1, gap_mm: 2, font_size: 8, show_brand: true, show_model: true, show_price: true, show_sku: true, show_barcode: true, show_name: false, ...(settings.label ?? {}) };

  const loadPrinters = async () => {
    setLoadingP(true);
    try { setPrinters(await api.get('/printing/printers')); } catch (e) { toast.error(e); } finally { setLoadingP(false); }
  };
  useEffect(() => { loadPrinters(); }, []);
  useEffect(() => {
    (async () => {
      try {
        const r = await renderReceipt(SAMPLE_ORDER, settings, cfg.receipt.paper === 'K80' ? 576 : 384);
        setPreview({ receipt: monoToDataUrl(r), label: monoToDataUrl(renderLabel(SAMPLE_LABEL, labelCfg)) });
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.receipt.paper, settings]);

  const upd = (part: 'receipt' | 'label', patch: any) => setCfg((c) => ({ ...c, [part]: { ...c[part], ...patch } }));
  const save = () => { saveDeviceCfg(cfg); toast.success('Đã lưu cấu hình máy in cho thiết bị này'); };
  const go = async (fn: () => Promise<unknown> | unknown, ok: string) => {
    setBusy(true);
    try { saveDeviceCfg(cfg); await fn(); toast.success(ok); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const printerOptions = (printers?.printers ?? []).map((p) => ({ value: p, label: p }));
  const rm = RECEIPT_METHODS.find((m) => m.value === cfg.receipt.method);
  const lm = LABEL_METHODS.find((m) => m.value === cfg.label.method);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-gold-50 border border-gold-200 p-4 text-sm text-ink-700 flex gap-3">
        <Info size={18} className="text-gold-600 shrink-0 mt-0.5" />
        <div>Cấu hình ở trang này lưu riêng cho <b>thiết bị/trình duyệt đang dùng</b> ({/Android/i.test(navigator.userAgent) ? 'thiết bị Android' : 'máy tính'}). Máy tính quầy in tem và máy iMin in bill được cấu hình riêng, không ảnh hưởng nhau.
          {printers?.host && <> Máy chủ WATCH POS: <b>{printers.host}</b> ({printers.platform}).</>}</div>
      </div>

      {/* =============================================== HÓA ĐƠN */}
      <div className="card">
        <div className="px-6 py-4 border-b border-ivory-200 flex items-center gap-2"><Receipt size={18} className="text-gold-600" /><h3 className="font-semibold">Máy in hóa đơn (bill)</h3></div>
        <div className="p-6 grid lg:grid-cols-[1fr_260px] gap-6">
          <div className="space-y-4">
            <Field label="Cách in" hint={rm?.hint}><Select value={cfg.receipt.method} onChange={(e) => upd('receipt', { method: e.target.value })} options={RECEIPT_METHODS} /></Field>
            <Field label="Khổ giấy"><Select value={cfg.receipt.paper} onChange={(e) => upd('receipt', { paper: e.target.value })} options={[{ value: 'K58', label: 'K58 – giấy 58mm (iMin M2 Pro)' }, { value: 'K80', label: 'K80 – giấy 80mm' }, ...(cfg.receipt.method === 'browser' || cfg.receipt.method === 'pdf' ? [{ value: 'A5', label: 'A5 – máy in văn phòng' }] : [])]} /></Field>
            {cfg.receipt.method === 'server' && (
              <Field label="Máy in trên máy tính chủ">
                <div className="flex gap-2"><Select value={cfg.receipt.printer} onChange={(e) => upd('receipt', { printer: e.target.value })} placeholder="— Chọn máy in —" options={printerOptions} />
                  <button className="btn-outline btn-icon w-10 h-10" onClick={loadPrinters} title="Tải lại"><RefreshCw size={15} className={cx(loadingP && 'animate-spin')} /></button></div>
              </Field>
            )}
            {(cfg.receipt.method === 'rawbt' || cfg.receipt.method === 'server') && (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Toggle checked={cfg.receipt.cut} onChange={(v) => upd('receipt', { cut: v })} label="Cắt giấy sau khi in" />
                <Toggle checked={cfg.receipt.drawer} onChange={(v) => upd('receipt', { drawer: v })} label="Mở két tiền" />
              </div>
            )}
            <Toggle checked={cfg.receipt.auto} onChange={(v) => upd('receipt', { auto: v })} label="Tự động in bill sau khi thanh toán ở POS" />
            <div className="flex flex-wrap gap-2 pt-2">
              <button className="btn-primary" onClick={save}><Save size={15} /> Lưu</button>
              <button className="btn-gold" disabled={busy} onClick={() => go(() => printReceiptDevice(SAMPLE_ORDER, settings, { cfg }), 'Đã gửi bill in thử')}><Printer size={15} /> In thử hóa đơn</button>
              {cfg.receipt.method === 'rawbt' && <button className="btn-outline" disabled={busy} onClick={() => go(() => sendToRawBT(new TextEncoder().encode('\x1b@WATCH POS - KET NOI RAWBT OK\n\n\n\n')), 'Đã gửi sang RawBT')}>Thử kết nối RawBT (chữ không dấu)</button>}
            </div>
          </div>
          <div>
            <div className="label">Ảnh sẽ in ({cfg.receipt.paper === 'K80' ? '576' : '384'} chấm)</div>
            <div className="bg-ivory-200 rounded-xl p-3 max-h-[460px] overflow-y-auto scroll-thin">{preview.receipt ? <img src={preview.receipt} className="w-full bg-white shadow" style={{ imageRendering: 'pixelated' }} /> : <div className="text-xs text-ink-400">Đang dựng...</div>}</div>
          </div>
        </div>
      </div>

      {/* =============================================== TEM */}
      <div className="card">
        <div className="px-6 py-4 border-b border-ivory-200 flex items-center gap-2"><Tag size={18} className="text-gold-600" /><h3 className="font-semibold">Máy in tem sản phẩm</h3></div>
        <div className="p-6 grid lg:grid-cols-[1fr_260px] gap-6">
          <div className="space-y-4">
            <Field label="Cách in" hint={lm?.hint}><Select value={cfg.label.method} onChange={(e) => upd('label', { method: e.target.value })} options={LABEL_METHODS} /></Field>
            {cfg.label.method === 'server' && <>
              <Field label="Máy in tem trên máy tính chủ" hint={printers?.error ?? (printers && !printers.printers.length ? 'Chưa thấy máy in nào. Hãy cài driver Xprinter và cắm USB.' : undefined)}>
                <div className="flex gap-2"><Select value={cfg.label.printer} onChange={(e) => upd('label', { printer: e.target.value })} placeholder="— Chọn máy in (VD: Xprinter XP-350B) —" options={printerOptions} />
                  <button className="btn-outline btn-icon w-10 h-10" onClick={loadPrinters} title="Tải lại"><RefreshCw size={15} className={cx(loadingP && 'animate-spin')} /></button></div>
              </Field>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Khoảng cách tem (mm)"><input className="input" type="number" step="0.5" min={0} value={cfg.label.gap_mm} onChange={(e) => upd('label', { gap_mm: Number(e.target.value) })} /></Field>
                <Field label="Độ đậm (1–15)"><input className="input" type="number" min={1} max={15} value={cfg.label.density} onChange={(e) => upd('label', { density: Number(e.target.value) })} /></Field>
                <Field label="Tốc độ (2–6)"><input className="input" type="number" min={1} max={6} value={cfg.label.speed} onChange={(e) => upd('label', { speed: Number(e.target.value) })} /></Field>
                <Field label="Lệch ngang (chấm)"><input className="input" type="number" value={cfg.label.offset_x} onChange={(e) => upd('label', { offset_x: Number(e.target.value) })} /></Field>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Toggle checked={cfg.label.direction === 0} onChange={(v) => upd('label', { direction: v ? 0 : 1 })} label="Xoay ngược 180°" />
                <Toggle checked={cfg.label.invert} onChange={(v) => upd('label', { invert: v })} label="Đảo màu (bật nếu tem in ra bị đen nền)" />
              </div>
            </>}
            <p className="text-xs text-ink-400">Kích thước tem ({labelCfg.width_mm} × {labelCfg.height_mm} mm) và nội dung tem chỉnh ở trang <b>Mã vạch & In tem</b>. X350B in khổ 20–82mm.</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <button className="btn-primary" onClick={save}><Save size={15} /> Lưu</button>
              <button className="btn-gold" disabled={busy} onClick={() => go(() => printLabelsDevice([{ ...SAMPLE_LABEL, copies: 1 }], labelCfg, settings, cfg.label.method), 'Đã gửi tem in thử')}><Printer size={15} /> In thử 1 tem</button>
              {cfg.label.method === 'server' && <button className="btn-outline" disabled={busy} onClick={() => go(() => sendToServerPrinter(cfg.label.printer, tsplLabels([{ bmp: renderLabel(SAMPLE_LABEL, labelCfg), copies: 3 }], { width_mm: labelCfg.width_mm, height_mm: labelCfg.height_mm, gap_mm: cfg.label.gap_mm, density: cfg.label.density, speed: cfg.label.speed, direction: cfg.label.direction, invert: cfg.label.invert, offset_x: cfg.label.offset_x }), 'test'), 'Đã gửi 3 tem')}>In thử 3 tem liên tiếp</button>}
              {cfg.label.method === 'server' && <button className="btn-outline" disabled={busy} onClick={() => go(() => sendToServerPrinter(cfg.label.printer, new TextEncoder().encode(`SIZE ${labelCfg.width_mm} mm,${labelCfg.height_mm} mm\r\nGAP ${cfg.label.gap_mm} mm,0 mm\r\nCLS\r\nBOX 8,8,${labelCfg.width_mm * 8 - 8},${labelCfg.height_mm * 8 - 8},3\r\nTEXT 24,24,"3",0,1,1,"WATCH POS TSPL OK"\r\nBARCODE 24,70,"128",60,1,0,2,2,"TEST123"\r\nPRINT 1,1\r\n`), 'test'), 'Đã gửi lệnh TSPL gốc')}>Kiểm tra lệnh TSPL gốc</button>}
            </div>
          </div>
          <div>
            <div className="label">Ảnh tem sẽ in ({labelCfg.width_mm * 8} × {labelCfg.height_mm * 8} chấm)</div>
            <div className="bg-ivory-200 rounded-xl p-3">{preview.label && <img src={preview.label} className="w-full bg-white shadow" style={{ imageRendering: 'pixelated' }} />}</div>
          </div>
        </div>
      </div>
      <button className="btn-ghost btn-sm" onClick={() => { const d = defaultDeviceCfg(settings); setCfg(d); saveDeviceCfg(d); }}>Khôi phục mặc định cho thiết bị này</button>
    </div>
  );
}

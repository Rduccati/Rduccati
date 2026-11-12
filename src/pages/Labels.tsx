import { useEffect, useMemo, useState } from 'react';
import { FileDown, Printer, Trash2, ListPlus, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { printerService } from '../lib/printer';
import { loadDeviceCfg, printLabelsDevice, LABEL_METHODS } from '../lib/devicePrint';
import { labelHtml, labelsJob, LABEL_CSS, type LabelCfg, type LabelItem } from '../lib/documents';
import { Empty, Field, PageHeader, Select, Toggle, useSubmit, useUi } from '../components/ui';
import ProductPicker from '../components/ProductPicker';

const PRESETS: { label: string; w: number; h: number; cols: number }[] = [
  { label: '50 × 30 mm', w: 50, h: 30, cols: 3 }, { label: '40 × 25 mm', w: 40, h: 25, cols: 4 }, { label: '35 × 22 mm (tem 3 cột)', w: 35, h: 22, cols: 5 },
  { label: '70 × 22 mm (tem treo đồng hồ)', w: 70, h: 22, cols: 2 }, { label: '60 × 40 mm', w: 60, h: 40, cols: 3 },
];

export default function Labels() {
  const { settings, can, reloadSettings } = useAuth();
  const { toast } = useUi();
  const [cfg, setCfg] = useState<LabelCfg>(() => ({ width_mm: 50, height_mm: 30, columns: 3, gap_mm: 2, font_size: 8, show_brand: true, show_model: true, show_price: true, show_sku: true, show_barcode: true, show_name: false, layout: 'a4', ...(settings.label ?? {}) }));
  const [items, setItems] = useState<(LabelItem & { id: number; copies: number })[]>([]);
  const { busy, run } = useSubmit();
  const [printing, setPrinting] = useState(false);
  useEffect(() => { if (settings.label) setCfg((c) => ({ ...c, ...settings.label })); }, [settings.label]);

  const add = (p: any, copies = 1) => setItems((xs) => {
    const ex = xs.find((x) => x.id === p.id);
    if (ex) return xs.map((x) => (x.id === p.id ? { ...x, copies: x.copies + copies } : x));
    return [...xs, { id: p.id, name: p.name, brand_name: p.brand_name, model: p.model, sku: p.sku, barcode: p.barcode, barcode_type: p.barcode_type, sale_price: p.sale_price, promo_price: p.promo_price, copies }];
  });
  const addInStock = async () => {
    try {
      const r = await api.get('/products', { stock: 'in', active: '1', pageSize: 500 });
      r.rows.forEach((p: any) => add(p, p.stock_qty));
      toast.success(`Đã thêm ${r.rows.length} sản phẩm còn hàng (số tem = số lượng tồn)`);
    } catch (e) { toast.error(e); }
  };
  const expanded = useMemo(() => items.flatMap((it) => Array.from({ length: Math.max(0, it.copies) }, () => it)), [items]);
  const job = () => labelsJob(expanded, cfg);
  const set = (k: keyof LabelCfg) => (e: any) => setCfg({ ...cfg, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  const sample: LabelItem = items[0] ?? { name: 'Omega Seamaster Diver 300M', brand_name: 'Omega', model: 'Seamaster', sku: 'OME-0001', barcode: '2000000000015', barcode_type: 'EAN13', sale_price: 152000000 };

  return (
    <div>
      <PageHeader title="Mã vạch & In tem" subtitle="Thiết kế tem, xem trước và in một hoặc hàng loạt (PDF / trình duyệt)"
        actions={<>
          <button className="btn-outline" disabled={!expanded.length} onClick={() => printerService.downloadPdf(job()).catch(toast.error)}><FileDown size={16} /> Xuất PDF</button>
          <button className="btn-outline" disabled={!expanded.length} onClick={() => printerService.print(job(), 'browser').catch(toast.error)}><Printer size={16} /> In qua trình duyệt</button>
          <button className="btn-primary" disabled={!expanded.length || printing} title={LABEL_METHODS.find((m) => m.value === loadDeviceCfg(settings).label.method)?.label}
            onClick={async () => { setPrinting(true); try { await printLabelsDevice(items, cfg, settings); toast.success(`Đã gửi ${expanded.length} tem tới máy in`); } catch (e) { toast.error(e); } finally { setPrinting(false); } }}><Printer size={16} /> In {expanded.length} tem</button>
        </>} />
      <div className="grid xl:grid-cols-[380px_minmax(0,1fr)] gap-5">
        <div className="space-y-5">
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold">Thiết kế tem</h3>
            <Field label="Kích thước mẫu"><Select value="" placeholder="Chọn kích thước có sẵn..." onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) setCfg({ ...cfg, width_mm: p.w, height_mm: p.h, columns: p.cols }); }} options={PRESETS.map((p, i) => ({ value: i, label: p.label }))} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Rộng (mm)"><input className="input" type="number" min={20} max={120} value={cfg.width_mm} onChange={set('width_mm')} /></Field>
              <Field label="Cao (mm)"><input className="input" type="number" min={10} max={80} value={cfg.height_mm} onChange={set('height_mm')} /></Field>
              <Field label="Cỡ chữ (pt)"><input className="input" type="number" min={5} max={14} value={cfg.font_size} onChange={set('font_size')} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Khổ giấy" className="col-span-1"><Select value={cfg.layout ?? 'a4'} onChange={set('layout')} options={[{ value: 'a4', label: 'A4' }, { value: 'roll', label: 'Cuộn tem' }]} /></Field>
              {cfg.layout !== 'roll' && <>
                <Field label="Số cột"><input className="input" type="number" min={1} max={8} value={cfg.columns} onChange={set('columns')} /></Field>
                <Field label="Khoảng cách"><input className="input" type="number" min={0} max={10} value={cfg.gap_mm} onChange={set('gap_mm')} /></Field>
              </>}
            </div>
            <div className="grid grid-cols-2 gap-y-2.5">
              <Toggle checked={cfg.show_brand} onChange={(v) => setCfg({ ...cfg, show_brand: v })} label="Thương hiệu" />
              <Toggle checked={cfg.show_model} onChange={(v) => setCfg({ ...cfg, show_model: v })} label="Model" />
              <Toggle checked={cfg.show_name} onChange={(v) => setCfg({ ...cfg, show_name: v })} label="Tên sản phẩm" />
              <Toggle checked={cfg.show_price} onChange={(v) => setCfg({ ...cfg, show_price: v })} label="Giá bán" />
              <Toggle checked={cfg.show_sku} onChange={(v) => setCfg({ ...cfg, show_sku: v })} label="SKU" />
              <Toggle checked={cfg.show_barcode} onChange={(v) => setCfg({ ...cfg, show_barcode: v })} label="Barcode" />
            </div>
            <div>
              <div className="label">Xem trước 1 tem (phóng to)</div>
              <div className="bg-ivory-200 rounded-xl p-4 flex justify-center overflow-auto">
                <style>{LABEL_CSS}</style>
                <div style={{ zoom: Math.min(2, 300 / (cfg.width_mm * 3.78)) }} dangerouslySetInnerHTML={{ __html: labelHtml(sample, cfg) }} />
              </div>
            </div>
            {can('settings.edit') && <button className="btn-outline w-full" disabled={busy} onClick={async () => { if (await run(() => api.put('/settings/label', cfg), 'Đã lưu mẫu tem mặc định')) reloadSettings(); }}><Save size={15} /> Lưu làm mẫu tem mặc định</button>}
          </div>
        </div>
        <div className="card min-w-0">
          <div className="p-4 border-b border-ivory-200 flex flex-wrap gap-3">
            <div className="flex-1 min-w-[240px]"><ProductPicker onPick={(p) => add(p)} placeholder="Thêm sản phẩm cần in tem (quét barcode hoặc tìm)..." /></div>
            <button className="btn-outline" onClick={addInStock}><ListPlus size={16} /> In theo danh sách tồn kho</button>
            {items.length > 0 && <button className="btn-ghost text-red-600" onClick={() => setItems([])}><Trash2 size={15} /> Xóa hết</button>}
          </div>
          {items.length === 0 ? <Empty title="Chưa chọn sản phẩm">Chọn sản phẩm để in tem đơn lẻ, hoặc bấm "In theo danh sách tồn kho" để in hàng loạt.</Empty> : (
            <>
              <div className="table-wrap max-h-[300px] overflow-y-auto scroll-thin">
                <table className="tbl"><thead><tr><th>Sản phẩm</th><th>Barcode</th><th className="num">Số tem</th><th></th></tr></thead>
                  <tbody>{items.map((it) => (
                    <tr key={it.id}><td><div className="font-medium">{it.name}</div><div className="text-xs text-ink-400">{it.sku}</div></td><td className="font-mono text-xs">{it.barcode} <span className="text-ink-300">({it.barcode_type})</span></td>
                      <td className="num"><input className="input h-8 w-20 text-center" type="number" min={0} value={it.copies} onChange={(e) => setItems(items.map((x) => (x.id === it.id ? { ...x, copies: Math.max(0, Number(e.target.value)) } : x)))} /></td>
                      <td><button className="btn-ghost btn-icon w-8 h-8" onClick={() => setItems(items.filter((x) => x.id !== it.id))}><Trash2 size={14} /></button></td></tr>
                  ))}</tbody></table>
              </div>
              <div className="p-4 border-t border-ivory-200">
                <div className="label">Xem trước trang in ({expanded.length} tem{expanded.length > 60 ? ', hiển thị 60 tem đầu' : ''})</div>
                <div className="bg-ivory-200 rounded-xl p-4 overflow-auto max-h-[520px] scroll-thin">
                  <div className="bg-white shadow mx-auto p-[8mm]" style={{ width: cfg.layout === 'roll' ? `${cfg.width_mm + 16}mm` : '210mm' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: cfg.layout === 'roll' ? '1fr' : `repeat(${cfg.columns}, ${cfg.width_mm}mm)`, gap: `${cfg.gap_mm}mm` }}
                      dangerouslySetInnerHTML={{ __html: expanded.slice(0, 60).map((it) => labelHtml(it, cfg)).join('') }} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

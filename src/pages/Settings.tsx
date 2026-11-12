import { useEffect, useRef, useState } from 'react';
import { DatabaseBackup, Download, Edit3, ImagePlus, KeyRound, LocateFixed, Plus, Printer, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, dateTime, today } from '../lib/format';
import { printerService } from '../lib/printer';
import { receiptJob } from '../lib/documents';
import PrinterSetup from '../components/PrinterSetup';
import { Badge, Empty, Field, Loading, Modal, MoneyInput, PageHeader, Pagination, SearchInput, Select, Textarea, Toggle, cx, useFetch, useSubmit, useUi } from '../components/ui';

type Sec = 'store' | 'invoice' | 'barcode' | 'printer' | 'inventory' | 'attendance' | 'finance' | 'promotions' | 'brands' | 'backup' | 'data' | 'account' | 'audit';

export default function Settings() {
  const { can } = useAuth();
  const sections: { key: Sec; label: string; show: boolean }[] = [
    { key: 'store', label: 'Thông tin cửa hàng', show: can('settings.edit') },
    { key: 'invoice', label: 'Mẫu hóa đơn', show: can('settings.edit') },
    { key: 'barcode', label: 'Mã vạch & SKU', show: can('settings.edit') },
    { key: 'printer', label: 'Máy in & in thử', show: can('pos.sell', 'products.view') },
    { key: 'inventory', label: 'Kho & bảo dưỡng', show: can('settings.edit') },
    { key: 'attendance', label: 'Chấm công', show: can('settings.edit') },
    { key: 'finance', label: 'Số dư quỹ đầu kỳ', show: can('settings.edit') },
    { key: 'promotions', label: 'Khuyến mãi', show: can('promotions.edit') },
    { key: 'brands', label: 'Thương hiệu', show: can('products.edit') },
    { key: 'backup', label: 'Sao lưu & khôi phục', show: can('backup.manage') },
    { key: 'data', label: 'Dữ liệu mẫu', show: can('backup.manage') },
    { key: 'account', label: 'Tài khoản & mật khẩu', show: true },
    { key: 'audit', label: 'Lịch sử hoạt động', show: can('audit.view') },
  ];
  const visible = sections.filter((s) => s.show);
  const [sec, setSec] = useState<Sec>(visible[0].key);
  return (
    <div>
      <PageHeader title="Cài đặt hệ thống" />
      <div className="grid lg:grid-cols-[230px_1fr] gap-5">
        <nav className="card p-2 h-fit lg:sticky lg:top-4 flex lg:flex-col overflow-x-auto">
          {visible.map((s) => (
            <button key={s.key} onClick={() => setSec(s.key)} className={cx('text-left px-3.5 py-2.5 rounded-xl text-sm whitespace-nowrap transition', sec === s.key ? 'bg-ink-900 text-gold-200 font-medium' : 'text-ink-600 hover:bg-ivory-100')}>{s.label}</button>
          ))}
        </nav>
        <div className="min-w-0">
          {sec === 'store' && <StoreSec />}
          {sec === 'invoice' && <InvoiceSec />}
          {sec === 'barcode' && <SimpleSec k="barcode" title="Mã vạch & SKU" fields={[
            { key: 'type', label: 'Loại barcode mặc định khi tự sinh', type: 'select', options: [{ value: 'EAN13', label: 'EAN-13 (13 số, phổ biến bán lẻ)' }, { value: 'CODE128', label: 'Code 128 (chữ + số)' }] },
            { key: 'ean_prefix', label: 'Tiền tố EAN-13 (nội bộ: 20–29)', hint: 'Mã EAN nội bộ cửa hàng nên bắt đầu bằng 20–29 để không trùng mã hãng' },
            { key: 'code128_prefix', label: 'Tiền tố Code 128', hint: 'VD: WP → WP00000001' },
            { key: 'sku_prefix', label: 'Tiền tố SKU (tùy chọn)', hint: 'SKU tự sinh: [tiền tố][3 chữ đầu thương hiệu]-[số thứ tự], VD: OME-0001' },
          ]} />}
          {sec === 'printer' && <PrinterSec />}
          {sec === 'inventory' && <InventorySec />}
          {sec === 'attendance' && <AttendanceSec />}
          {sec === 'finance' && <SimpleSec k="finance" title="Số dư quỹ đầu kỳ" desc="Số tiền có sẵn trước khi bắt đầu dùng phần mềm – dùng để tính tồn quỹ trong Sổ quỹ." fields={[{ key: 'opening_cash', label: 'Tiền mặt đầu kỳ', type: 'money' }, { key: 'opening_bank', label: 'Tiền ngân hàng đầu kỳ', type: 'money' }]} />}
          {sec === 'promotions' && <PromotionsSec />}
          {sec === 'brands' && <BrandsSec />}
          {sec === 'backup' && <BackupSec />}
          {sec === 'data' && <DataSec />}
          {sec === 'account' && <AccountSec />}
          {sec === 'audit' && <AuditSec />}
        </div>
      </div>
    </div>
  );
}

function useSetting(k: string) {
  const { settings, reloadSettings } = useAuth();
  const [v, setV] = useState<any>(settings[k] ?? {});
  useEffect(() => setV(settings[k] ?? {}), [settings, k]);
  const { busy, run } = useSubmit();
  const save = async (val = v) => { if (await run(() => api.put(`/settings/${k}`, val), 'Đã lưu cài đặt')) await reloadSettings(); };
  return { v, setV, save, busy };
}

function Section({ title, desc, children, onSave, busy }: { title: string; desc?: string; children: React.ReactNode; onSave?: () => void; busy?: boolean }) {
  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-ivory-200"><h3 className="font-semibold text-ink-900">{title}</h3>{desc && <p className="text-xs text-ink-400 mt-0.5">{desc}</p>}</div>
      <div className="p-6">{children}</div>
      {onSave && <div className="px-6 py-3.5 border-t border-ivory-200 bg-ivory-50 rounded-b-2xl flex justify-end"><button className="btn-primary" disabled={busy} onClick={onSave}><Save size={15} /> Lưu thay đổi</button></div>}
    </div>
  );
}

function SimpleSec({ k, title, desc, fields }: { k: string; title: string; desc?: string; fields: { key: string; label: string; hint?: string; type?: 'select' | 'money' | 'number' | 'toggle'; options?: { value: string; label: string }[] }[] }) {
  const { v, setV, save, busy } = useSetting(k);
  return (
    <Section title={title} desc={desc} onSave={() => save()} busy={busy}>
      <div className="grid sm:grid-cols-2 gap-4">
        {fields.map((f) => (
          f.type === 'toggle' ? <div key={f.key} className="sm:col-span-2"><Toggle checked={!!v[f.key]} onChange={(x) => setV({ ...v, [f.key]: x })} label={f.label} /></div> :
          <Field key={f.key} label={f.label} hint={f.hint}>
            {f.type === 'select' ? <Select value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} options={f.options!} />
              : f.type === 'money' ? <MoneyInput value={v[f.key] ?? 0} onChange={(x) => setV({ ...v, [f.key]: x })} />
              : f.type === 'number' ? <input className="input" type="number" value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: Number(e.target.value) })} />
              : <input className="input" value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}
          </Field>
        ))}
      </div>
    </Section>
  );
}

function StoreSec() {
  const { v, setV, save, busy } = useSetting('store');
  const { toast } = useUi();
  const ref = useRef<HTMLInputElement>(null);
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  return (
    <Section title="Thông tin cửa hàng" desc="Hiển thị trên hóa đơn, phiếu bảo hành, phiếu nhận sửa chữa" onSave={() => save()} busy={busy}>
      <div className="grid sm:grid-cols-[160px_1fr] gap-6">
        <div>
          <div className="aspect-square rounded-2xl border-2 border-dashed border-ivory-400 flex items-center justify-center overflow-hidden bg-ivory-100 cursor-pointer hover:border-gold-400" onClick={() => ref.current?.click()}>
            {v.logo ? <img src={v.logo} className="w-full h-full object-contain p-2" /> : <div className="text-center text-xs text-ink-400"><ImagePlus className="mx-auto mb-1" size={20} />Tải logo</div>}
          </div>
          {v.logo && <button className="btn-ghost btn-sm w-full mt-2 text-red-600" onClick={() => setV({ ...v, logo: null })}>Xóa logo</button>}
          <input ref={ref} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const r = await api.upload('/uploads', f); setV({ ...v, logo: r.url }); } catch (er) { toast.error(er); } }} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Tên cửa hàng" required><input className="input" value={v.name ?? ''} onChange={set('name')} /></Field>
          <Field label="Slogan"><input className="input" value={v.slogan ?? ''} onChange={set('slogan')} /></Field>
          <Field label="Địa chỉ" className="sm:col-span-2"><input className="input" value={v.address ?? ''} onChange={set('address')} /></Field>
          <Field label="Số điện thoại"><input className="input" value={v.phone ?? ''} onChange={set('phone')} /></Field>
          <Field label="Email"><input className="input" value={v.email ?? ''} onChange={set('email')} /></Field>
          <Field label="Website / Fanpage"><input className="input" value={v.website ?? ''} onChange={set('website')} /></Field>
          <Field label="Mã số thuế"><input className="input" value={v.tax_code ?? ''} onChange={set('tax_code')} /></Field>
          <Field label="Ngân hàng"><input className="input" value={v.bank_name ?? ''} onChange={set('bank_name')} /></Field>
          <Field label="Số tài khoản"><input className="input" value={v.bank_account ?? ''} onChange={set('bank_account')} /></Field>
          <Field label="Chủ tài khoản" className="sm:col-span-2"><input className="input" value={v.bank_owner ?? ''} onChange={set('bank_owner')} /></Field>
        </div>
      </div>
    </Section>
  );
}

const SAMPLE_ORDER = {
  id: 0, code: 'DH000123', created_at: new Date().toISOString(), created_by_name: 'Nguyễn Thu Trang', customer_name: 'Nguyễn Minh Tuấn', customer_phone: '0903123456',
  subtotal: 19750000, discount_amount: 500000, promotion_amount: 0, total: 19250000, paid_amount: 19250000, customer_given: 20000000, change_amount: 750000, refunded_amount: 0, status: 'completed', note: '',
  items: [{ product_name: 'Tissot PRX Powermatic 80', sku: 'TIS-0001', serial_number: 'TIS1100000701', quantity: 1, unit_price: 18950000, discount: 0, line_total: 18950000, warranty_months: 24 },
    { product_name: 'Pin đồng hồ Renata 371', sku: 'PK-0003', serial_number: null, quantity: 10, unit_price: 80000, discount: 0, line_total: 800000, warranty_months: 0 }],
  payments: [{ method: 'cash', amount: 19250000 }],
};

function InvoiceSec() {
  const { settings } = useAuth();
  const { v, setV, save, busy } = useSetting('invoice');
  const { toast } = useUi();
  const job = receiptJob(SAMPLE_ORDER, { ...settings, invoice: v }, v.paper);
  return (
    <div className="grid xl:grid-cols-[1fr_360px] gap-5">
      <Section title="Mẫu hóa đơn" desc="Áp dụng khi in từ POS và Đơn hàng" onSave={() => save()} busy={busy}>
        <div className="space-y-4">
          <Field label="Khổ giấy mặc định"><Select value={v.paper ?? 'K80'} onChange={(e) => setV({ ...v, paper: e.target.value })} options={[{ value: 'K80', label: 'K80 (giấy nhiệt 80mm)' }, { value: 'K58', label: 'K58 (giấy nhiệt 58mm)' }, { value: 'A5', label: 'A5 (máy in văn phòng)' }]} /></Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Toggle checked={!!v.show_logo} onChange={(x) => setV({ ...v, show_logo: x })} label="Hiển thị logo" />
            <Toggle checked={!!v.show_customer} onChange={(x) => setV({ ...v, show_customer: x })} label="Thông tin khách hàng" />
            <Toggle checked={!!v.show_barcode} onChange={(x) => setV({ ...v, show_barcode: x })} label="Mã vạch mã đơn" />
            <Toggle checked={!!v.show_warranty} onChange={(x) => setV({ ...v, show_warranty: x })} label="Thông tin bảo hành" />
          </div>
          <Field label="Lời cảm ơn / chính sách cuối hóa đơn"><Textarea rows={3} value={v.footer ?? ''} onChange={(e) => setV({ ...v, footer: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-2">
            <button className="btn-outline" onClick={() => printerService.print(job, 'browser').catch(toast.error)}><Printer size={15} /> In thử</button>
            <button className="btn-outline" onClick={() => printerService.previewPdf(job).catch(toast.error)}>Xem PDF</button>
          </div>
        </div>
      </Section>
      <div className="card p-4">
        <div className="label">Xem trước ({v.paper ?? 'K80'})</div>
        <iframe title="preview" className="w-full h-[640px] bg-white rounded-xl border border-ivory-300" srcDoc={`<html><head><meta charset="utf-8"><style>body{margin:12px;font-family:Arial}${job.pageCss}</style></head><body>${job.html}</body></html>`} />
      </div>
    </div>
  );
}

function PrinterSec() {
  return <PrinterSetup />;
}

function InventorySec() {
  const inv = useSetting('inventory');
  const mt = useSetting('maintenance');
  const { data: warehouses, reload } = useFetch(() => api.get('/warehouses'), []);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useSubmit();
  return (
    <div className="space-y-5">
      <Section title="Cảnh báo & bảo dưỡng" onSave={async () => { await inv.save(); await mt.save(); }} busy={inv.busy || mt.busy}>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Cảnh báo tồn kho lâu sau (ngày)"><input className="input" type="number" min={1} value={inv.v.aging_days ?? 180} onChange={(e) => inv.setV({ ...inv.v, aging_days: Number(e.target.value) })} /></Field>
          <Field label="Chu kỳ nhắc bảo dưỡng đồng hồ cơ (tháng)" hint="0 = không tạo nhắc"><input className="input" type="number" min={0} value={mt.v.interval_months ?? 36} onChange={(e) => mt.setV({ ...mt.v, interval_months: Number(e.target.value) })} /></Field>
        </div>
      </Section>
      <Section title="Kho / chi nhánh">
        <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Mã</th><th>Tên kho</th><th>Địa chỉ</th><th className="num">Tồn</th><th></th></tr></thead>
          <tbody>{(warehouses ?? []).map((w: any) => <tr key={w.id}><td className="font-mono">{w.code}</td><td>{w.name} {w.is_default && <Badge tone="gold">Mặc định</Badge>} {!w.is_active && <Badge tone="red">Ngừng</Badge>}</td><td>{w.address}</td><td className="num">{w.total_qty}</td><td><button className="btn-ghost btn-icon w-8 h-8" onClick={() => setEdit(w)}><Edit3 size={14} /></button></td></tr>)}</tbody></table></div>
        <button className="btn-outline mt-3" onClick={() => setEdit({ code: '', name: '', address: '', is_default: false, is_active: true })}><Plus size={15} /> Thêm kho</button>
      </Section>
      {edit && (
        <Modal open size="sm" title={edit.id ? 'Sửa kho' : 'Thêm kho'} onClose={() => setEdit(null)}
          footer={<><button className="btn-outline" onClick={() => setEdit(null)}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => (edit.id ? api.put(`/warehouses/${edit.id}`, edit) : api.post('/warehouses', edit)), 'Đã lưu kho')) { setEdit(null); reload(); } }}>Lưu</button></>}>
          <div className="space-y-3">
            <Field label="Mã kho"><input className="input" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Tên kho"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Địa chỉ"><input className="input" value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Toggle checked={edit.is_default} onChange={(x) => setEdit({ ...edit, is_default: x })} label="Kho mặc định khi bán hàng" />
            <Toggle checked={edit.is_active} onChange={(x) => setEdit({ ...edit, is_active: x })} label="Đang hoạt động" />
          </div>
        </Modal>
      )}
    </div>
  );
}

function AttendanceSec() {
  const { v, setV, save, busy } = useSetting('attendance');
  const { toast } = useUi();
  return (
    <Section title="Cấu hình chấm công" desc="Nhân viên check-in bằng điện thoại/máy tính, hệ thống kiểm tra khoảng cách GPS tới cửa hàng" onSave={() => save()} busy={busy}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Vĩ độ cửa hàng (lat)"><input className="input" value={v.store_lat ?? ''} onChange={(e) => setV({ ...v, store_lat: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="Kinh độ cửa hàng (lng)"><input className="input" value={v.store_lng ?? ''} onChange={(e) => setV({ ...v, store_lng: e.target.value ? Number(e.target.value) : null })} /></Field>
        <div className="sm:col-span-2"><button className="btn-outline" onClick={() => navigator.geolocation?.getCurrentPosition((p) => { setV({ ...v, store_lat: Number(p.coords.latitude.toFixed(6)), store_lng: Number(p.coords.longitude.toFixed(6)) }); toast.success('Đã lấy vị trí hiện tại – nhớ bấm Lưu'); }, () => toast.error('Không lấy được vị trí. Hãy cho phép quyền truy cập vị trí.'))}><LocateFixed size={15} /> Lấy vị trí hiện tại (đứng tại cửa hàng)</button></div>
        <Field label="Bán kính cho phép (mét)"><input className="input" type="number" min={20} value={v.radius_m ?? 200} onChange={(e) => setV({ ...v, radius_m: Number(e.target.value) })} /></Field>
        <div className="flex items-end pb-2"><Toggle checked={!!v.require_location} onChange={(x) => setV({ ...v, require_location: x })} label="Bắt buộc ở trong bán kính khi chấm công" /></div>
      </div>
    </Section>
  );
}

function PromotionsSec() {
  const { data, loading, reload } = useFetch(() => api.get('/promotions'), []);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useSubmit();
  const { confirm, toast } = useUi();
  return (
    <Section title="Chương trình khuyến mãi" desc="Mã giảm giá áp dụng tại POS">
      {loading || !data ? <Loading /> : data.length === 0 ? <Empty title="Chưa có khuyến mãi" /> : (
        <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Mã</th><th>Tên</th><th>Giảm</th><th>Đơn tối thiểu</th><th>Thời gian</th><th className="num">Đã dùng</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>{data.map((p: any) => <tr key={p.id}><td className="font-mono font-semibold">{p.code}</td><td>{p.name}</td><td>{p.discount_type === 'percent' ? `${p.discount_value}%${p.max_discount ? ` (tối đa ${Number(p.max_discount).toLocaleString('vi-VN')}đ)` : ''}` : `${Number(p.discount_value).toLocaleString('vi-VN')}đ`}</td>
            <td>{Number(p.min_order).toLocaleString('vi-VN')}đ</td><td className="text-xs">{p.start_date ?? '…'} → {p.end_date ?? '…'}</td><td className="num">{p.used_count}{p.usage_limit ? `/${p.usage_limit}` : ''}</td>
            <td>{p.is_active ? <Badge tone="green">Đang áp dụng</Badge> : <Badge>Ngừng</Badge>}</td>
            <td className="whitespace-nowrap"><button className="btn-ghost btn-icon w-8 h-8" onClick={() => setEdit(p)}><Edit3 size={14} /></button><button className="btn-ghost btn-icon w-8 h-8 hover:text-red-600" onClick={async () => { if (await confirm({ title: `Xóa mã ${p.code}?`, danger: true })) { try { const r = await api.del(`/promotions/${p.id}`); toast.success(r.message ?? 'Đã xóa'); reload(); } catch (e) { toast.error(e); } } }}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
      )}
      <button className="btn-outline mt-3" onClick={() => setEdit({ code: '', name: '', discount_type: 'percent', discount_value: 5, max_discount: '', min_order: 0, start_date: today(), end_date: addDays(today(), 30), usage_limit: '', is_active: true })}><Plus size={15} /> Thêm khuyến mãi</button>
      {edit && (
        <Modal open title={edit.id ? 'Sửa khuyến mãi' : 'Thêm khuyến mãi'} onClose={() => setEdit(null)}
          footer={<><button className="btn-outline" onClick={() => setEdit(null)}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => (edit.id ? api.put(`/promotions/${edit.id}`, edit) : api.post('/promotions', edit)), 'Đã lưu khuyến mãi')) { setEdit(null); reload(); } }}>Lưu</button></>}>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Mã" required><input className="input uppercase" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Tên chương trình" required><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Kiểu giảm"><Select value={edit.discount_type} onChange={(e) => setEdit({ ...edit, discount_type: e.target.value })} options={[{ value: 'percent', label: 'Phần trăm (%)' }, { value: 'amount', label: 'Số tiền (đ)' }]} /></Field>
            <Field label="Giá trị giảm">{edit.discount_type === 'percent' ? <input className="input" type="number" min={1} max={100} value={edit.discount_value} onChange={(e) => setEdit({ ...edit, discount_value: Number(e.target.value) })} /> : <MoneyInput value={edit.discount_value} onChange={(x) => setEdit({ ...edit, discount_value: x })} />}</Field>
            {edit.discount_type === 'percent' && <Field label="Giảm tối đa"><MoneyInput value={edit.max_discount || 0} placeholder="Không giới hạn" onChange={(x) => setEdit({ ...edit, max_discount: x || '' })} /></Field>}
            <Field label="Đơn tối thiểu"><MoneyInput value={edit.min_order} onChange={(x) => setEdit({ ...edit, min_order: x })} /></Field>
            <Field label="Từ ngày"><input className="input" type="date" value={edit.start_date ?? ''} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></Field>
            <Field label="Đến ngày"><input className="input" type="date" value={edit.end_date ?? ''} onChange={(e) => setEdit({ ...edit, end_date: e.target.value })} /></Field>
            <Field label="Giới hạn lượt dùng"><input className="input" type="number" min={1} value={edit.usage_limit ?? ''} placeholder="Không giới hạn" onChange={(e) => setEdit({ ...edit, usage_limit: e.target.value })} /></Field>
            <div className="flex items-end pb-2"><Toggle checked={edit.is_active} onChange={(x) => setEdit({ ...edit, is_active: x })} label="Đang áp dụng" /></div>
          </div>
        </Modal>
      )}
    </Section>
  );
}

function BrandsSec() {
  const { data, reload } = useFetch(() => api.get('/brands'), []);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const { busy, run } = useSubmit();
  const { confirm, toast } = useUi();
  return (
    <Section title="Thương hiệu đồng hồ">
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input w-56" placeholder="Tên thương hiệu" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input w-40" placeholder="Xuất xứ" value={country} onChange={(e) => setCountry(e.target.value)} />
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={async () => { if (await run(() => api.post('/brands', { name, country }), 'Đã thêm thương hiệu')) { setName(''); setCountry(''); reload(); } }}><Plus size={15} /> Thêm</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(data ?? []).map((b: any) => (
          <div key={b.id} className="flex items-center gap-2 rounded-xl border border-ivory-300 pl-3 pr-1 py-1 text-sm">
            <span className="font-medium">{b.name}</span><span className="text-xs text-ink-400">{b.country} · {b.product_count} SP</span>
            <button className="p-1 text-ink-300 hover:text-red-600" onClick={async () => { if (await confirm({ title: `Xóa thương hiệu ${b.name}?`, danger: true })) { try { await api.del(`/brands/${b.id}`); reload(); } catch (e) { toast.error(e); } } }}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function BackupSec() {
  const { toast, confirm } = useUi();
  const { data: files, reload } = useFetch(() => api.get('/backup/files'), []);
  const { busy, run } = useSubmit();
  const fileRef = useRef<HTMLInputElement>(null);
  const restore = async (opts: { file?: File; name?: string }) => {
    const ok = await confirm({ title: 'Khôi phục dữ liệu?', danger: true, confirmText: 'Khôi phục', message: 'Toàn bộ dữ liệu hiện tại sẽ được thay bằng dữ liệu trong bản sao lưu. Hệ thống tự tạo một bản sao lưu an toàn trước khi khôi phục.' });
    if (!ok) return;
    const r = await run(() => (opts.file ? api.upload('/backup/restore', opts.file) : api.post('/backup/restore', { file_name: opts.name })));
    if (r) { toast.success(`Đã khôi phục. Bản an toàn: ${r.safety_backup}`); setTimeout(() => window.location.reload(), 1200); }
  };
  return (
    <div className="space-y-5">
      <Section title="Sao lưu dữ liệu" desc="Hệ thống tự sao lưu mỗi ngày vào thư mục data/backups (giữ 30 bản). Nên tải bản sao lưu về USB / Google Drive định kỳ.">
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => api.download('/backup/download').catch(toast.error)}><Download size={15} /> Tải bản sao lưu về máy</button>
          <button className="btn-outline" disabled={busy} onClick={async () => { if (await run(() => api.post('/backup/create'), 'Đã tạo bản sao lưu trên máy chủ')) reload(); }}><DatabaseBackup size={15} /> Tạo bản sao lưu trên máy chủ</button>
        </div>
      </Section>
      <Section title="Khôi phục dữ liệu">
        <button className="btn-outline" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={15} /> Khôi phục từ file .json</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore({ file: f }); e.target.value = ''; }} />
        <div className="mt-5">
          <div className="label">Bản sao lưu trên máy chủ</div>
          {(files ?? []).length === 0 ? <div className="text-sm text-ink-400">Chưa có</div> : (
            <div className="table-wrap border border-ivory-300 rounded-xl max-h-80 overflow-y-auto"><table className="tbl"><thead><tr><th>Tên file</th><th>Thời gian</th><th className="num">Dung lượng</th><th></th></tr></thead>
              <tbody>{files.map((f: any) => <tr key={f.name}><td className="font-mono text-xs">{f.name}</td><td>{dateTime(f.created_at)}</td><td className="num">{(f.size / 1024).toFixed(0)} KB</td>
                <td className="whitespace-nowrap"><button className="btn-ghost btn-sm" onClick={() => api.download(`/backup/files/${encodeURIComponent(f.name)}`, undefined, f.name).catch(toast.error)}><Download size={13} /></button><button className="btn-ghost btn-sm" onClick={() => restore({ name: f.name })}><RotateCcw size={13} /> Khôi phục</button></td></tr>)}</tbody></table></div>
          )}
        </div>
      </Section>
    </div>
  );
}

function DataSec() {
  const { toast } = useUi();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const { busy, run } = useSubmit();
  return (
    <Section title="Dữ liệu mẫu" desc="Dữ liệu mẫu giúp kiểm tra toàn bộ hệ thống trước khi sử dụng thật.">
      <div className="space-y-3 text-sm text-ink-600">
        <p>Khi chuyển sang sử dụng thật, xóa toàn bộ dữ liệu kinh doanh mẫu: sản phẩm, serial, tồn kho, đơn hàng, khách hàng, nhà cung cấp, thu chi, bảo hành, sửa chữa, chấm công.</p>
        <p><b>Được giữ lại:</b> tài khoản người dùng, phân quyền, cài đặt cửa hàng, kho, ca làm việc, lịch sử thao tác. Hệ thống tự tạo bản sao lưu trước khi xóa.</p>
        <p className="text-xs text-ink-400">Gợi ý: sau khi xóa, vào Nhân viên để khóa/xóa các tài khoản mẫu (quanly, banhang1, banhang2, kho) nếu không dùng.</p>
        <button className="btn-danger" onClick={() => setOpen(true)}><Trash2 size={15} /> Xóa dữ liệu mẫu / dữ liệu kinh doanh</button>
      </div>
      {open && (
        <Modal open size="sm" title="Xác nhận xóa dữ liệu" onClose={() => setOpen(false)}
          footer={<><button className="btn-outline" onClick={() => setOpen(false)}>Hủy</button><button className="btn-danger" disabled={busy || text !== 'XOA DU LIEU'} onClick={async () => { const r = await run(() => api.post('/system/clear-business-data', { confirm: text })); if (r) { toast.success(`Đã xóa dữ liệu. Bản sao lưu: ${r.safety_backup}`); setTimeout(() => window.location.reload(), 1200); } }}>Xóa vĩnh viễn</button></>}>
          <p className="text-sm text-ink-600 mb-3">Gõ <b className="font-mono">XOA DU LIEU</b> để xác nhận:</p>
          <input className="input font-mono" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
        </Modal>
      )}
    </Section>
  );
}

function AccountSec() {
  const { user } = useAuth();
  const [f, setF] = useState({ old_password: '', new_password: '', confirm: '' });
  const { busy, run } = useSubmit();
  const { toast } = useUi();
  return (
    <Section title="Tài khoản & mật khẩu" desc={`${user?.full_name} · ${user?.username} · ${user?.role_name}`}>
      <div className="max-w-sm space-y-3">
        <Field label="Mật khẩu hiện tại"><input className="input" type="password" autoComplete="current-password" value={f.old_password} onChange={(e) => setF({ ...f, old_password: e.target.value })} /></Field>
        <Field label="Mật khẩu mới" hint="Tối thiểu 6 ký tự"><input className="input" type="password" autoComplete="new-password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
        <Field label="Nhập lại mật khẩu mới"><input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <button className="btn-primary" disabled={busy || !f.old_password || !f.new_password} onClick={async () => {
          if (f.new_password !== f.confirm) return toast.error('Mật khẩu nhập lại không khớp');
          if (await run(() => api.post('/auth/change-password', f), 'Đã đổi mật khẩu')) setF({ old_password: '', new_password: '', confirm: '' });
        }}><KeyRound size={15} /> Đổi mật khẩu</button>
      </div>
    </Section>
  );
}

function AuditSec() {
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading } = useFetch(() => api.get('/audit-logs', { q, entity, page, pageSize: 40 }), [q, entity, page]);
  useEffect(() => setPage(1), [q, entity]);
  const ENT: Record<string, string> = { order: 'Đơn hàng', product: 'Sản phẩm', stock_document: 'Phiếu kho', customer: 'Khách hàng', user: 'Tài khoản', settings: 'Cài đặt', cash_transaction: 'Thu chi', repair: 'Sửa chữa', warranty: 'Bảo hành', system: 'Hệ thống', attendance: 'Chấm công', shift: 'Ca bán hàng', role: 'Phân quyền', supplier: 'Nhà cung cấp', serial: 'Serial', promotion: 'Khuyến mãi' };
  return (
    <Section title="Lịch sử hoạt động" desc="Ghi nhận mọi thao tác thêm/sửa/xóa, đăng nhập, in lại hóa đơn, sao lưu...">
      <div className="flex flex-wrap gap-3 mb-4">
        <SearchInput className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Tìm nội dung" />
        <Select className="w-auto" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Mọi đối tượng" options={Object.entries(ENT).map(([value, label]) => ({ value, label }))} />
      </div>
      {loading && !data ? <Loading /> : data && (
        <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Đối tượng</th><th>Nội dung</th><th>IP</th></tr></thead>
          <tbody>{data.rows.map((a: any) => <tr key={a.id}><td className="whitespace-nowrap text-ink-500">{dateTime(a.created_at)}</td><td>{a.user_name ?? '—'}</td><td><Badge>{ENT[a.entity] ?? a.entity}</Badge></td><td className="max-w-[420px]">{a.description}</td><td className="text-xs text-ink-400">{a.ip}</td></tr>)}</tbody></table>
          <Pagination page={page} pageSize={40} total={data.total} onChange={setPage} /></div>
      )}
    </Section>
  );
}

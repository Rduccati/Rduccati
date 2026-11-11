import { useState } from 'react';
import { Edit3, FileSpreadsheet, Plus, Trash2, Truck, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, LABELS, money } from '../lib/format';
import { Empty, ErrorBox, Field, InfoRow, Loading, Modal, MoneyInput, PageHeader, SearchInput, Select, StatCard, Tabs, Textarea, Toggle, Badge, useFetch, useSubmit, useUi } from '../components/ui';

export default function Suppliers() {
  const { can } = useAuth();
  const { toast } = useUi();
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useFetch(() => api.get('/suppliers', { q }), [q]);
  const [editing, setEditing] = useState<any>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const totalDebt = (data ?? []).reduce((s: number, x: any) => s + Math.max(0, x.debt), 0);
  return (
    <div>
      <PageHeader title="Nhà cung cấp" subtitle={data ? `${data.length} nhà cung cấp · công nợ phải trả ${money(totalDebt)}` : undefined}
        actions={<>
          {can('suppliers.edit') && <button className="btn-outline" onClick={() => setImporting(true)}><Upload size={16} /> Import Excel</button>}
          <button className="btn-outline" onClick={() => api.download('/suppliers/export.xlsx').catch(toast.error)}><FileSpreadsheet size={16} /> Export Excel</button>
          {can('suppliers.edit') && <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Thêm nhà cung cấp</button>}
        </>} />
      <div className="card">
        <div className="p-4 border-b border-ivory-200"><SearchInput className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Tên, mã, SĐT" /></div>
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : data && (data.length === 0 ? <Empty icon={<Truck size={22} />} title="Chưa có nhà cung cấp" /> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Nhà cung cấp</th><th>Liên hệ</th><th className="num">Số phiếu nhập</th><th className="num">Tổng giá trị nhập</th><th className="num">Công nợ phải trả</th><th></th></tr></thead>
            <tbody>{data.map((s: any) => (
              <tr key={s.id} className="clickable" onClick={() => setViewId(s.id)}>
                <td><div className="font-medium">{s.name} {!s.is_active && <Badge tone="red">Ngừng GD</Badge>}</div><div className="text-xs text-ink-400">{s.code}</div></td>
                <td>{s.contact_name}<div className="text-xs text-ink-400">{s.phone}</div></td><td className="num">{s.import_count}</td><td className="num">{money(s.total_import)}</td>
                <td className="num font-semibold">{s.debt > 0 ? <span className="text-red-600">{money(s.debt)}</span> : money(s.debt)}</td>
                <td onClick={(e) => e.stopPropagation()}>{can('suppliers.edit') && <button className="btn-ghost btn-icon w-8 h-8" onClick={() => setEditing(s)}><Edit3 size={15} /></button>}</td>
              </tr>
            ))}</tbody></table></div>
        ))}
      </div>
      {editing && <SupplierForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {viewId && <SupplierDetail id={viewId} onClose={() => setViewId(null)} onChanged={reload} />}
      {importing && <SupplierImport onClose={() => setImporting(false)} onDone={reload} />}
    </div>
  );
}

function SupplierForm({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ code: '', name: '', contact_name: '', phone: '', email: '', address: '', tax_code: '', opening_debt: 0, note: '', is_active: true, ...initial });
  const { busy, run } = useSubmit();
  const { confirm, toast } = useUi();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open title={f.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'} onClose={onClose}
      footer={<>
        {f.id && <button className="btn-outline text-red-600 mr-auto" onClick={async () => { if (await confirm({ title: 'Xóa nhà cung cấp?', danger: true })) { try { await api.del(`/suppliers/${f.id}`); toast.success('Đã xóa'); onSaved(); } catch (e) { toast.error(e); } } }}><Trash2 size={15} /> Xóa</button>}
        <button className="btn-outline" onClick={onClose}>Hủy</button>
        <button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => (f.id ? api.put(`/suppliers/${f.id}`, f) : api.post('/suppliers', f)), 'Đã lưu nhà cung cấp')) onSaved(); }}>Lưu</button>
      </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Mã NCC" hint="Để trống để tự sinh"><input className="input" value={f.code ?? ''} onChange={set('code')} /></Field>
        <Field label="Tên nhà cung cấp" required><input className="input" autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Người liên hệ"><input className="input" value={f.contact_name ?? ''} onChange={set('contact_name')} /></Field>
        <Field label="Điện thoại"><input className="input" value={f.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" value={f.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Mã số thuế"><input className="input" value={f.tax_code ?? ''} onChange={set('tax_code')} /></Field>
        <Field label="Địa chỉ" className="sm:col-span-2"><input className="input" value={f.address ?? ''} onChange={set('address')} /></Field>
        <Field label="Nợ phải trả đầu kỳ"><MoneyInput value={f.opening_debt} onChange={(v) => setF({ ...f, opening_debt: v })} /></Field>
        <div className="flex items-end pb-2"><Toggle checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Đang giao dịch" /></div>
        <Field label="Ghi chú" className="sm:col-span-2"><Textarea rows={2} value={f.note ?? ''} onChange={set('note')} /></Field>
      </div>
    </Modal>
  );
}

function SupplierDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const { data: s, loading, reload } = useFetch(() => api.get(`/suppliers/${id}`), [id]);
  const [tab, setTab] = useState<'imports' | 'payments'>('imports');
  const [pay, setPay] = useState({ amount: 0, method: 'transfer', note: '' });
  const { busy, run } = useSubmit();
  return (
    <Modal open size="lg" onClose={onClose} title={s?.name ?? 'Nhà cung cấp'} subtitle={s?.code}>
      {loading && !s ? <Loading /> : s && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Công nợ phải trả" value={<span className={s.debt > 0 ? 'text-red-600' : ''}>{money(s.debt)}</span>} />
            <StatCard label="Số phiếu nhập" value={s.imports.length} />
            <StatCard label="Tổng giá trị nhập" value={money(s.imports.reduce((a: number, d: any) => a + (d.doc_type === 'import' ? d.total_amount : 0), 0))} />
          </div>
          <div className="grid md:grid-cols-2 gap-x-8"><div><InfoRow label="Liên hệ">{s.contact_name}</InfoRow><InfoRow label="Điện thoại">{s.phone}</InfoRow><InfoRow label="Email">{s.email}</InfoRow></div><div><InfoRow label="Địa chỉ">{s.address}</InfoRow><InfoRow label="MST">{s.tax_code}</InfoRow><InfoRow label="Nợ đầu kỳ">{money(s.opening_debt)}</InfoRow></div></div>
          {can('finance.edit') && s.debt > 0 && (
            <div className="rounded-2xl bg-ivory-100 p-4 flex flex-wrap gap-3 items-end">
              <Field label="Trả nợ nhà cung cấp"><MoneyInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></Field>
              <Field label="Hình thức"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} options={[{ value: 'transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }]} /></Field>
              <Field label="Ghi chú" className="flex-1 min-w-[160px]"><input className="input" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
              <button className="btn-primary" disabled={busy || pay.amount <= 0} onClick={async () => { if (await run(() => api.post('/finance/transactions', { tx_type: 'payment', category: 'supplier_payment', method: pay.method, amount: pay.amount, supplier_id: s.id, note: pay.note || `Trả nợ ${s.name}` }), 'Đã lập phiếu chi')) { setPay({ amount: 0, method: 'transfer', note: '' }); reload(); onChanged(); } }}>Lập phiếu chi</button>
            </div>
          )}
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'imports', label: 'Lịch sử nhập hàng', count: s.imports.length }, { value: 'payments', label: 'Lịch sử thanh toán', count: s.payments.length }]} />
          {tab === 'imports' ? (s.imports.length === 0 ? <Empty title="Chưa nhập hàng" /> : <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Phiếu</th><th>Ngày</th><th>Kho</th><th className="num">Giá trị</th><th className="num">Trả ngay</th><th>Người tạo</th></tr></thead>
            <tbody>{s.imports.map((d: any) => <tr key={d.id}><td className="font-mono">{d.code}</td><td>{dateTime(d.created_at)}</td><td>{d.warehouse_name}</td><td className="num">{money(d.total_amount)}</td><td className="num">{money(d.paid_amount)}</td><td>{d.created_by_name}</td></tr>)}</tbody></table></div>)
            : (s.payments.length === 0 ? <Empty title="Chưa có thanh toán" /> : <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Phiếu</th><th>Ngày</th><th>Hình thức</th><th className="num">Số tiền</th><th>Diễn giải</th></tr></thead>
              <tbody>{s.payments.map((p: any) => <tr key={p.id}><td className="font-mono">{p.code}</td><td>{dateTime(p.created_at)}</td><td>{LABELS.method[p.method]}</td><td className="num">{p.tx_type === 'payment' ? '-' : '+'}{money(p.amount)}</td><td className="text-xs">{p.note}</td></tr>)}</tbody></table></div>)}
        </div>
      )}
    </Modal>
  );
}

function SupplierImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<any>(null);
  const { busy, run } = useSubmit();
  return (
    <Modal open title="Import nhà cung cấp" onClose={onClose} footer={<><button className="btn-outline" onClick={onClose}>Đóng</button><button className="btn-primary" disabled={!file || busy} onClick={async () => { const r = await run(() => api.upload('/suppliers/import', file!)); if (r) { setRes(r); onDone(); } }}>Import</button></>}>
      <p className="text-sm text-ink-600 mb-3">File Excel với các cột: <b>Mã, Tên, Người liên hệ, Điện thoại, Email, Địa chỉ, Mã số thuế, Nợ đầu kỳ, Ghi chú</b> (giống file Export). Mã trùng sẽ được cập nhật.</p>
      <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      {res && <div className="mt-3 rounded-xl bg-ivory-100 p-3 text-sm">Tạo mới {res.created} · Cập nhật {res.updated}{res.errors.map((e: string) => <div key={e} className="text-red-600">{e}</div>)}</div>}
    </Modal>
  );
}

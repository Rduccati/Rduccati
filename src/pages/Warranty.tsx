import { useEffect, useState } from 'react';
import { BellRing, Check, Edit3, Plus, Printer, Search, ShieldCheck, Trash2, Wrench, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, date, dateTime, LABELS, money, today } from '../lib/format';
import { printHtml } from '../lib/printer';
import { repairTicketHtml, warrantyCardHtml } from '../lib/documents';
import { Badge, Empty, ErrorBox, Field, InfoRow, Loading, Modal, MoneyInput, PageHeader, Pagination, SearchInput, Select, Tabs, Textarea, Toggle, cx, useFetch, useSubmit, useUi } from '../components/ui';

type Tab = 'repairs' | 'warranties' | 'reminders' | 'lookup';
const REPAIR_TONE: Record<string, string> = { received: 'blue', diagnosing: 'violet', repairing: 'amber', waiting_parts: 'amber', done: 'green', delivered: 'gray', cancelled: 'red' };
const W_TONE: Record<string, string> = { active: 'green', expired: 'gray', void: 'red' };

export default function Warranty() {
  const [tab, setTab] = useState<Tab>('repairs');
  return (
    <div>
      <PageHeader title="Bảo hành & Sửa chữa" subtitle="Phiếu bảo hành theo serial, tiếp nhận sửa chữa, nhắc lịch bảo dưỡng" />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ value: 'repairs', label: 'Phiếu sửa chữa' }, { value: 'warranties', label: 'Phiếu bảo hành' }, { value: 'reminders', label: 'Nhắc bảo dưỡng' }, { value: 'lookup', label: 'Tra cứu nhanh' }]} />
      {tab === 'repairs' && <RepairsTab />}
      {tab === 'warranties' && <WarrantiesTab />}
      {tab === 'reminders' && <RemindersTab />}
      {tab === 'lookup' && <LookupTab />}
    </div>
  );
}

// ================================================================ SỬA CHỮA
function RepairsTab() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => api.get('/repairs', { q, status, page, pageSize: 25 }), [q, status, page]);
  useEffect(() => setPage(1), [q, status]);
  const [creating, setCreating] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);
  const counts = Object.fromEntries((data?.counts ?? []).map((c: any) => [c.status, c.n]));
  return (
    <div className="card">
      <div className="p-4 flex flex-wrap gap-3 border-b border-ivory-200">
        <SearchInput className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Mã phiếu, khách, SĐT, serial, hãng" />
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'open', label: 'Đang xử lý' }, { value: '', label: 'Tất cả' }, ...Object.entries(LABELS.repairStatus).map(([value, label]) => ({ value, label: `${label} (${counts[value] ?? 0})` }))]} />
        {can('warranty.edit') && <button className="btn-primary sm:ml-auto" onClick={() => setCreating(true)}><Plus size={16} /> Tiếp nhận đồng hồ</button>}
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && (data.rows.length === 0 ? <Empty icon={<Wrench size={22} />} title="Không có phiếu sửa chữa" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Mã phiếu</th><th>Khách hàng</th><th>Đồng hồ</th><th>Yêu cầu</th><th>Ngày nhận</th><th>Hẹn trả</th><th className="num">Chi phí</th><th>Trạng thái</th></tr></thead>
          <tbody>{data.rows.map((r: any) => (
            <tr key={r.id} className="clickable" onClick={() => setViewId(r.id)}>
              <td className="font-mono font-semibold">{r.code}{r.is_warranty && <Badge tone="green" className="ml-1.5">BH</Badge>}</td>
              <td>{r.customer_name}<div className="text-xs text-ink-400">{r.customer_phone}</div></td>
              <td>{[r.watch_brand, r.watch_model].filter(Boolean).join(' ')}<div className="text-xs text-ink-400 font-mono">{r.serial_number}</div></td>
              <td className="max-w-[220px] truncate text-ink-600">{r.issue}</td><td className="text-ink-500">{date(r.received_at)}</td>
              <td className={cx(r.expected_at && r.expected_at < today() && !['delivered', 'cancelled', 'done'].includes(r.status) && 'text-red-600 font-medium')}>{date(r.expected_at)}</td>
              <td className="num">{money(r.final_cost || r.estimated_cost)}</td><td><Badge tone={REPAIR_TONE[r.status]}>{LABELS.repairStatus[r.status]}</Badge></td>
            </tr>
          ))}</tbody></table>
          <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} /></div>
      ))}
      {creating && <RepairForm onClose={() => setCreating(false)} onSaved={(r) => { setCreating(false); reload(); setViewId(r.id); }} />}
      {viewId && <RepairDetail id={viewId} onClose={() => setViewId(null)} onChanged={reload} />}
    </div>
  );
}

function RepairForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (r: any) => void }) {
  const isEdit = !!initial?.id;
  const [f, setF] = useState<any>({ customer_id: null, customer_name: '', customer_phone: '', watch_brand: '', watch_model: '', serial_number: '', receive_condition: '', accessories: '', issue: '', is_warranty: false, estimated_cost: 0, final_cost: 0, deposit: 0, deposit_method: 'cash', technician: '', expected_at: addDays(today(), 7), note: '', ...initial });
  const [lookup, setLookup] = useState<any>(null);
  const { busy, run } = useSubmit();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  // Tự điền theo serial đã bán / SĐT khách
  const checkSerial = async () => {
    if (!f.serial_number?.trim()) return;
    try {
      const r = await api.get('/warranty-lookup', { q: f.serial_number.trim() });
      const w = r.warranties[0];
      setLookup(w ?? null);
      if (w) setF((x: any) => ({ ...x, customer_id: w.customer_id, customer_name: x.customer_name || w.customer_name || '', customer_phone: x.customer_phone || w.customer_phone || '', watch_model: x.watch_model || w.product_name, is_warranty: w.state === 'active' }));
    } catch { /* ignore */ }
  };
  const checkPhone = async () => {
    if (!f.customer_phone?.trim() || f.customer_name) return;
    try { const r = await api.get('/customers', { q: f.customer_phone.trim(), pageSize: 1 }); if (r.rows[0]) setF((x: any) => ({ ...x, customer_id: r.rows[0].id, customer_name: r.rows[0].name })); } catch { /* ignore */ }
  };
  return (
    <Modal open size="lg" title={isEdit ? `Sửa phiếu ${initial.code}` : 'Tiếp nhận đồng hồ sửa chữa / bảo hành'} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { const r = await run(() => (isEdit ? api.put(`/repairs/${initial.id}`, f) : api.post('/repairs', f)), isEdit ? 'Đã lưu phiếu' : 'Đã tạo phiếu nhận đồng hồ'); if (r) onSaved(isEdit ? initial : r); }}>{isEdit ? 'Lưu' : 'Tạo phiếu nhận'}</button></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Serial Number" hint="Nhập serial để tự kiểm tra bảo hành"><input className="input font-mono" value={f.serial_number ?? ''} onChange={set('serial_number')} onBlur={checkSerial} /></Field>
        <div className="flex items-end">{lookup ? <div className="rounded-xl bg-emerald-50 text-emerald-800 text-xs px-3 py-2 w-full">Đã bán: {lookup.product_name} · BH {lookup.code} {LABELS.warrantyState[lookup.state]} đến {date(lookup.end_date)}</div> : f.serial_number ? <div className="text-xs text-ink-400 pb-2">Không tìm thấy phiếu bảo hành cho serial này</div> : null}</div>
        <Field label="SĐT khách hàng"><input className="input" value={f.customer_phone ?? ''} onChange={set('customer_phone')} onBlur={checkPhone} /></Field>
        <Field label="Tên khách hàng" required><input className="input" value={f.customer_name} onChange={set('customer_name')} /></Field>
        <Field label="Hãng đồng hồ"><input className="input" value={f.watch_brand ?? ''} onChange={set('watch_brand')} /></Field>
        <Field label="Model"><input className="input" value={f.watch_model ?? ''} onChange={set('watch_model')} /></Field>
        <Field label="Tình trạng khi nhận (ngoại quan)" className="sm:col-span-2"><input className="input" value={f.receive_condition ?? ''} onChange={set('receive_condition')} placeholder="VD: trầy nhẹ vành bezel, kính không nứt, đồng hồ đang chạy" /></Field>
        <Field label="Phụ kiện kèm theo"><input className="input" value={f.accessories ?? ''} onChange={set('accessories')} placeholder="Hộp, sổ, dây phụ..." /></Field>
        <Field label="Kỹ thuật viên"><input className="input" value={f.technician ?? ''} onChange={set('technician')} /></Field>
        <Field label="Yêu cầu / mô tả lỗi" required className="sm:col-span-2"><Textarea rows={2} value={f.issue} onChange={set('issue')} /></Field>
        <Field label="Chi phí dự kiến"><MoneyInput value={f.estimated_cost} onChange={(v) => setF({ ...f, estimated_cost: v })} /></Field>
        {isEdit ? <Field label="Chi phí chốt"><MoneyInput value={f.final_cost} onChange={(v) => setF({ ...f, final_cost: v })} /></Field>
          : <Field label="Đặt cọc"><div className="flex gap-2"><MoneyInput value={f.deposit} onChange={(v) => setF({ ...f, deposit: v })} /><Select className="w-36" value={f.deposit_method} onChange={set('deposit_method')} options={[{ value: 'cash', label: 'Tiền mặt' }, { value: 'transfer', label: 'Chuyển khoản' }]} /></div></Field>}
        <Field label="Hẹn trả"><input className="input" type="date" value={f.expected_at ?? ''} onChange={set('expected_at')} /></Field>
        <div className="flex items-end pb-2"><Toggle checked={f.is_warranty} onChange={(v) => setF({ ...f, is_warranty: v })} label="Bảo hành (miễn phí theo chính sách)" /></div>
        <Field label="Ghi chú" className="sm:col-span-2"><Textarea rows={2} value={f.note ?? ''} onChange={set('note')} /></Field>
      </div>
    </Modal>
  );
}

function RepairDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { can, settings } = useAuth();
  const { toast } = useUi();
  const { data: r, loading, reload } = useFetch(() => api.get(`/repairs/${id}`), [id]);
  const [part, setPart] = useState({ part_name: '', quantity: 1, unit_cost: 0, unit_price: 0 });
  const [st, setSt] = useState<{ status: string; note: string; final_cost: number; payment_method: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const { busy, run } = useSubmit();
  const refresh = () => { reload(); onChanged(); };
  const partsTotal = (r?.parts ?? []).reduce((s: number, p: any) => s + p.quantity * p.unit_price, 0);
  const paid = (r?.payments ?? []).reduce((s: number, p: any) => s + (p.tx_type === 'receipt' ? p.amount : -p.amount), 0);
  const closed = r && ['delivered', 'cancelled'].includes(r.status);
  return (
    <Modal open size="xl" onClose={onClose} title={r ? <span className="flex items-center gap-2">Phiếu {r.code} <Badge tone={REPAIR_TONE[r.status]}>{LABELS.repairStatus[r.status]}</Badge></span> : 'Phiếu sửa chữa'} subtitle={r ? `Nhận ${dateTime(r.received_at)} · ${r.created_by_name ?? ''}` : ''}
      footer={r && <>
        <button className="btn-outline mr-auto" onClick={() => { const d = repairTicketHtml(r, settings); printHtml(d.html, { pageCss: d.pageCss, title: r.code }).catch(toast.error); }}><Printer size={15} /> In phiếu nhận đồng hồ</button>
        {can('warranty.edit') && !closed && <button className="btn-outline" onClick={() => setEditing(true)}><Edit3 size={15} /> Sửa</button>}
        {can('warranty.edit') && !closed && <button className="btn-primary" onClick={() => setSt({ status: r.status, note: '', final_cost: r.final_cost || r.estimated_cost || partsTotal, payment_method: 'cash' })}>Cập nhật trạng thái</button>}
      </>}>
      {loading && !r ? <Loading /> : r && (
        <div className="space-y-5">
          <div className="grid md:grid-cols-2 gap-x-8">
            <div>
              <InfoRow label="Khách hàng">{r.customer_name} · {r.customer_phone}</InfoRow>
              <InfoRow label="Đồng hồ">{[r.watch_brand, r.watch_model].filter(Boolean).join(' ')}</InfoRow>
              <InfoRow label="Serial">{r.serial_number}</InfoRow>
              <InfoRow label="Bảo hành">{r.is_warranty ? `Có${r.warranty_code ? ` – ${r.warranty_code} (đến ${date(r.warranty_end)})` : ''}` : 'Sửa chữa có phí'}</InfoRow>
              <InfoRow label="Tình trạng khi nhận">{r.receive_condition}</InfoRow>
              <InfoRow label="Phụ kiện">{r.accessories}</InfoRow>
            </div>
            <div>
              <InfoRow label="Yêu cầu">{r.issue}</InfoRow>
              <InfoRow label="Kỹ thuật viên">{r.technician}</InfoRow>
              <InfoRow label="Hẹn trả">{date(r.expected_at)}</InfoRow>
              <InfoRow label="Chi phí dự kiến / chốt">{money(r.estimated_cost)} / {money(r.final_cost)}</InfoRow>
              <InfoRow label="Đã thu (cọc + thanh toán)">{money(paid)}</InfoRow>
              {r.delivered_at && <InfoRow label="Ngày giao">{dateTime(r.delivered_at)}</InfoRow>}
            </div>
          </div>
          <div>
            <h4 className="label">Linh kiện thay thế</h4>
            <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl">
              <thead><tr><th>Linh kiện</th><th className="num">SL</th>{can('products.cost') && <th className="num">Giá vốn</th>}<th className="num">Giá tính khách</th><th className="num">Thành tiền</th><th></th></tr></thead>
              <tbody>
                {r.parts.map((p: any) => <tr key={p.id}><td>{p.part_name}</td><td className="num">{p.quantity}</td>{can('products.cost') && <td className="num">{money(p.unit_cost)}</td>}<td className="num">{money(p.unit_price)}</td><td className="num">{money(p.quantity * p.unit_price)}</td>
                  <td>{can('warranty.edit') && !closed && <button className="text-ink-300 hover:text-red-600" onClick={async () => { await run(() => api.del(`/repairs/${r.id}/parts/${p.id}`)); refresh(); }}><Trash2 size={14} /></button>}</td></tr>)}
                {can('warranty.edit') && !closed && (
                  <tr><td><input className="input h-8" placeholder="Tên linh kiện (VD: Kính sapphire, pin, ron...)" value={part.part_name} onChange={(e) => setPart({ ...part, part_name: e.target.value })} /></td>
                    <td><input className="input h-8 w-16" type="number" min={1} value={part.quantity} onChange={(e) => setPart({ ...part, quantity: Number(e.target.value) })} /></td>
                    {can('products.cost') && <td><MoneyInput className="h-8" value={part.unit_cost} onChange={(v) => setPart({ ...part, unit_cost: v })} /></td>}
                    <td><MoneyInput className="h-8" value={part.unit_price} onChange={(v) => setPart({ ...part, unit_price: v })} /></td><td className="num">{money(part.quantity * part.unit_price)}</td>
                    <td><button className="btn-primary btn-sm" disabled={busy || !part.part_name.trim()} onClick={async () => { if (await run(() => api.post(`/repairs/${r.id}/parts`, part))) { setPart({ part_name: '', quantity: 1, unit_cost: 0, unit_price: 0 }); refresh(); } }}><Plus size={13} /></button></td></tr>
                )}
              </tbody></table></div>
          </div>
          <div>
            <h4 className="label">Lịch sử xử lý</h4>
            <ol className="relative border-l border-ivory-300 ml-2 space-y-3">
              {r.logs.map((l: any) => (
                <li key={l.id} className="ml-4"><span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-gold-400" />
                  <div className="text-sm"><b>{LABELS.repairStatus[l.status] ?? l.status}</b>{l.note && <> – {l.note}</>}</div><div className="text-xs text-ink-400">{l.user_name} · {dateTime(l.created_at)}</div></li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {st && r && (
        <Modal open size="sm" title="Cập nhật trạng thái sửa chữa" onClose={() => setSt(null)}
          footer={<><button className="btn-outline" onClick={() => setSt(null)}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { const x = await run(() => api.post(`/repairs/${r.id}/status`, st)); if (x) { toast.success(x.collected > 0 ? `Đã cập nhật. Thu thêm ${money(x.collected)}` : 'Đã cập nhật trạng thái'); setSt(null); refresh(); } }}>Cập nhật</button></>}>
          <div className="space-y-3">
            <Field label="Trạng thái mới"><Select value={st.status} onChange={(e) => setSt({ ...st, status: e.target.value })} options={Object.entries(LABELS.repairStatus).map(([value, label]) => ({ value, label }))} /></Field>
            {['done', 'delivered'].includes(st.status) && <Field label="Chi phí chốt với khách" hint={`Linh kiện: ${money(partsTotal)} · đã thu: ${money(paid)}`}><MoneyInput value={st.final_cost} onChange={(v) => setSt({ ...st, final_cost: v })} /></Field>}
            {st.status === 'delivered' && <>
              <div className="rounded-xl bg-ivory-100 px-3 py-2 text-sm">{st.final_cost - paid >= 0 ? <>Cần thu thêm: <b>{money(st.final_cost - paid)}</b></> : <>Hoàn lại khách: <b>{money(paid - st.final_cost)}</b></>}</div>
              <Field label="Hình thức thanh toán"><Select value={st.payment_method} onChange={(e) => setSt({ ...st, payment_method: e.target.value })} options={[{ value: 'cash', label: 'Tiền mặt' }, { value: 'transfer', label: 'Chuyển khoản' }]} /></Field>
            </>}
            {st.status === 'cancelled' && paid > 0 && <div className="rounded-xl bg-amber-50 text-amber-800 px-3 py-2 text-sm">Hệ thống sẽ lập phiếu chi hoàn cọc {money(paid)}.</div>}
            <Field label="Ghi chú"><input className="input" value={st.note} onChange={(e) => setSt({ ...st, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {editing && r && <RepairForm initial={r} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}
    </Modal>
  );
}

// ================================================================ PHIẾU BẢO HÀNH
function WarrantiesTab() {
  const { can, settings } = useAuth();
  const { toast } = useUi();
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => api.get('/warranties', { q, state, page, pageSize: 25 }), [q, state, page]);
  useEffect(() => setPage(1), [q, state]);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const print = async (id: number) => {
    try { const w = await api.get(`/warranties/${id}`); const d = warrantyCardHtml(w, settings); await printHtml(d.html, { pageCss: d.pageCss, title: w.code }); } catch (e) { toast.error(e); }
  };
  return (
    <div className="card">
      <div className="p-4 flex flex-wrap gap-3 border-b border-ivory-200">
        <SearchInput className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Mã BH, serial, khách hàng, SĐT, mã đơn" />
        <Select className="w-auto" value={state} onChange={(e) => setState(e.target.value)} placeholder="Tất cả" options={[{ value: 'active', label: 'Còn bảo hành' }, { value: 'expiring', label: 'Sắp hết hạn (30 ngày)' }, { value: 'expired', label: 'Hết hạn' }, { value: 'void', label: 'Đã hủy' }]} />
        {can('warranty.edit') && <button className="btn-primary sm:ml-auto" onClick={() => setCreating(true)}><Plus size={16} /> Tạo phiếu bảo hành</button>}
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && (data.rows.length === 0 ? <Empty icon={<ShieldCheck size={22} />} title="Chưa có phiếu bảo hành">Phiếu bảo hành được tạo tự động khi bán đồng hồ có serial.</Empty> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Mã BH</th><th>Sản phẩm / Serial</th><th>Khách hàng</th><th>Đơn hàng</th><th>Thời hạn</th><th>Trạng thái</th><th className="num">Sửa chữa</th><th></th></tr></thead>
          <tbody>{data.rows.map((w: any) => (
            <tr key={w.id}>
              <td className="font-mono font-semibold">{w.code}</td><td><div className="font-medium">{w.product_name}</div><div className="text-xs font-mono text-gold-700">{w.serial_number}</div></td>
              <td>{w.customer_name ?? '—'}<div className="text-xs text-ink-400">{w.customer_phone}</div></td><td className="font-mono text-xs">{w.order_code ?? '—'}</td>
              <td className="whitespace-nowrap">{date(w.start_date)} → {date(w.end_date)}</td><td><Badge tone={W_TONE[w.state]}>{LABELS.warrantyState[w.state]}</Badge></td><td className="num">{w.repair_count || '—'}</td>
              <td className="whitespace-nowrap"><button className="btn-ghost btn-icon w-8 h-8" title="In phiếu bảo hành" onClick={() => print(w.id)}><Printer size={15} /></button>
                {can('warranty.edit') && <button className="btn-ghost btn-icon w-8 h-8" title="Sửa" onClick={() => setEdit(w)}><Edit3 size={15} /></button>}</td>
            </tr>
          ))}</tbody></table>
          <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} /></div>
      ))}
      {creating && <WarrantyForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {edit && <WarrantyEdit w={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function WarrantyForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ serial_number: '', product_name: '', customer_id: '', start_date: today(), end_date: addDays(today(), 365), terms: '', note: '' });
  const [cq, setCq] = useState('');
  const [cs, setCs] = useState<any[]>([]);
  useEffect(() => { if (!cq) return; const t = setTimeout(() => api.get('/customers', { q: cq, pageSize: 6 }).then((r) => setCs(r.rows)), 200); return () => clearTimeout(t); }, [cq]);
  const { busy, run } = useSubmit();
  return (
    <Modal open title="Tạo phiếu bảo hành thủ công" subtitle="Dùng cho đồng hồ bán trước khi dùng phần mềm hoặc gia hạn bảo hành" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => api.post('/warranties', { ...f, customer_id: f.customer_id || null }), 'Đã tạo phiếu bảo hành')) onSaved(); }}>Tạo phiếu</button></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Serial Number" required><input className="input font-mono" value={f.serial_number} onChange={(e) => setF({ ...f, serial_number: e.target.value })} /></Field>
        <Field label="Tên sản phẩm" hint="Bỏ trống nếu serial đã có trong hệ thống"><input className="input" value={f.product_name} onChange={(e) => setF({ ...f, product_name: e.target.value })} /></Field>
        <Field label="Khách hàng" className="sm:col-span-2">
          <input className="input" placeholder="Tìm theo tên / SĐT" value={cq} onChange={(e) => { setCq(e.target.value); setF({ ...f, customer_id: '' }); }} />
          {cs.length > 0 && !f.customer_id && <div className="mt-1 border border-ivory-300 rounded-xl overflow-hidden">{cs.map((c) => <button key={c.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-gold-50" onClick={() => { setF({ ...f, customer_id: c.id }); setCq(`${c.name} – ${c.phone ?? ''}`); setCs([]); }}>{c.name} · {c.phone}</button>)}</div>}
        </Field>
        <Field label="Từ ngày"><input className="input" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="Đến ngày"><input className="input" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        <Field label="Điều kiện bảo hành" className="sm:col-span-2"><Textarea rows={2} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function WarrantyEdit({ w, onClose, onSaved }: { w: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ end_date: w.end_date, status: w.status, terms: w.terms ?? '', note: w.note ?? '' });
  const { busy, run } = useSubmit();
  return (
    <Modal open size="sm" title={`Phiếu bảo hành ${w.code}`} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => api.put(`/warranties/${w.id}`, f), 'Đã cập nhật')) onSaved(); }}>Lưu</button></>}>
      <div className="space-y-3">
        <Field label="Ngày hết hạn (gia hạn)"><input className="input" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        <Field label="Trạng thái"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'active', label: 'Hiệu lực' }, { value: 'void', label: 'Hủy' }]} /></Field>
        <Field label="Điều kiện"><Textarea rows={2} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
        <Field label="Ghi chú"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ================================================================ NHẮC BẢO DƯỠNG
function RemindersTab() {
  const { can } = useAuth();
  const [status, setStatus] = useState('pending');
  const [range, setRange] = useState('due');
  const { data, loading, reload } = useFetch(() => api.get('/reminders', { status, range }), [status, range]);
  const { run } = useSubmit();
  const mark = async (id: number, s: string) => { if (await run(() => api.put(`/reminders/${id}`, { status: s }), 'Đã cập nhật')) reload(); };
  return (
    <div className="card">
      <div className="p-4 flex flex-wrap gap-3 border-b border-ivory-200">
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'pending', label: 'Chưa xử lý' }, { value: 'done', label: 'Đã liên hệ' }, { value: 'skipped', label: 'Bỏ qua' }]} />
        <Select className="w-auto" value={range} onChange={(e) => setRange(e.target.value)} options={[{ value: 'due', label: 'Đến hạn trong 30 ngày' }, { value: '', label: 'Tất cả' }]} />
        <p className="text-xs text-ink-400 self-center">Nhắc bảo dưỡng tự tạo khi bán đồng hồ cơ (chu kỳ cấu hình ở Cài đặt).</p>
      </div>
      {loading && !data ? <Loading /> : data && (data.length === 0 ? <Empty icon={<BellRing size={22} />} title="Không có lịch nhắc" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Ngày đến hạn</th><th>Khách hàng</th><th>Đồng hồ / Serial</th><th>Loại</th><th>Ghi chú</th><th></th></tr></thead>
          <tbody>{data.map((m: any) => (
            <tr key={m.id}><td className={cx('whitespace-nowrap', m.due_date < today() && m.status === 'pending' && 'text-red-600 font-medium')}>{date(m.due_date)}</td>
              <td>{m.customer_name}<div className="text-xs text-ink-400">{m.customer_phone}</div></td><td>{m.product_name}<div className="text-xs font-mono text-ink-400">{m.serial_number}</div></td>
              <td>{LABELS.reminder[m.reminder_type]}</td><td className="text-xs text-ink-500">{m.note}</td>
              <td className="whitespace-nowrap">{can('warranty.edit') && m.status === 'pending' && <><button className="btn-outline btn-sm" onClick={() => mark(m.id, 'done')}><Check size={13} /> Đã liên hệ</button> <button className="btn-ghost btn-sm" onClick={() => mark(m.id, 'skipped')}><X size={13} /></button></>}</td></tr>
          ))}</tbody></table></div>
      ))}
    </div>
  );
}

// ================================================================ TRA CỨU
function LookupTab() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  const { busy, run } = useSubmit();
  const search = async () => { if (q.trim()) setRes(await run(() => api.get('/warranty-lookup', { q: q.trim() }))); };
  return (
    <div className="card p-5 space-y-5">
      <div className="flex gap-2 max-w-xl">
        <div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" /><input className="input pl-9 h-11" autoFocus placeholder="Serial Number, mã bảo hành, mã phiếu sửa hoặc SĐT khách" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /></div>
        <button className="btn-primary h-11" disabled={busy} onClick={search}>Tra cứu</button>
      </div>
      {res && (res.warranties.length === 0 && res.repairs.length === 0 ? <Empty title="Không tìm thấy thông tin" /> : (
        <div className="grid lg:grid-cols-2 gap-5">
          <div><h4 className="label">Bảo hành</h4>{res.warranties.map((w: any) => (
            <div key={w.id} className="rounded-xl border border-ivory-300 p-4 mb-2"><div className="flex justify-between"><b>{w.product_name}</b><Badge tone={W_TONE[w.state]}>{LABELS.warrantyState[w.state]}</Badge></div>
              <div className="text-sm text-ink-500 mt-1">Serial {w.serial_number} · {w.code} · {date(w.start_date)} → {date(w.end_date)}</div><div className="text-sm">{w.customer_name} {w.customer_phone} · đơn {w.order_code ?? '—'}</div></div>))}</div>
          <div><h4 className="label">Sửa chữa</h4>{res.repairs.map((r: any) => (
            <div key={r.id} className="rounded-xl border border-ivory-300 p-4 mb-2"><div className="flex justify-between"><b>{r.code}</b><Badge tone={REPAIR_TONE[r.status]}>{LABELS.repairStatus[r.status]}</Badge></div>
              <div className="text-sm text-ink-500 mt-1">{r.issue}</div><div className="text-xs text-ink-400">{dateTime(r.received_at)}</div></div>))}</div>
        </div>
      ))}
    </div>
  );
}

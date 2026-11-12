import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, FileDown, FileSpreadsheet, Printer, RotateCcw, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, LABELS, money, today, addDays } from '../lib/format';
import { printerService } from '../lib/printer';
import { receiptJob } from '../lib/documents';
import { printReceiptDevice } from '../lib/devicePrint';
import { Badge, DateRange, Empty, ErrorBox, Field, InfoRow, Loading, Modal, PageHeader, Pagination, SearchInput, Select, useFetch, useSubmit, useUi } from '../components/ui';

export const ORDER_TONE: Record<string, string> = { completed: 'green', cancelled: 'red', returned: 'amber', partial_returned: 'amber' };

export default function Orders() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const { toast } = useUi();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(addDays(today(), -29));
  const [to, setTo] = useState(today());
  const [debt, setDebt] = useState(false);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(sp.get('open') ? Number(sp.get('open')) : null);
  const params = { q, status, from, to, page, pageSize: 20, debt: debt ? 1 : '' };
  const { data, loading, error, reload } = useFetch(() => api.get('/orders', params), [q, status, from, to, page, debt]);
  useEffect(() => setPage(1), [q, status, from, to, debt]);

  return (
    <div>
      <PageHeader title="Đơn hàng" subtitle={data ? `${data.total} đơn · doanh thu thuần ${money(data.revenue)}` : undefined}
        actions={<button className="btn-outline" onClick={() => api.download('/orders', { ...params, format: 'xlsx' }).catch(toast.error)}><FileSpreadsheet size={16} /> Xuất Excel</button>} />
      <div className="card">
        <div className="p-4 flex flex-wrap gap-3 items-center border-b border-ivory-200">
          <SearchInput className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Mã đơn, khách hàng, SĐT, serial..." />
          <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Tất cả trạng thái" options={Object.entries(LABELS.orderStatus).map(([value, label]) => ({ value, label }))} />
          <label className="flex items-center gap-2 text-sm text-ink-600"><input type="checkbox" checked={debt} onChange={(e) => setDebt(e.target.checked)} /> Còn nợ</label>
          <div className="sm:ml-auto"><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
        </div>
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : data && data.rows.length === 0 ? <Empty title="Không có đơn hàng phù hợp" /> : data && (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Mã đơn</th><th>Thời gian</th><th>Khách hàng</th><th>Sản phẩm</th><th className="num">Tổng tiền</th><th className="num">Còn nợ</th><th>Thanh toán</th><th>Trạng thái</th><th>Nhân viên</th></tr></thead>
              <tbody>
                {data.rows.map((o: any) => {
                  const d = Math.max(0, o.total - o.refunded_amount - o.paid_amount);
                  return (
                    <tr key={o.id} className="clickable" onClick={() => setOpenId(o.id)}>
                      <td className="font-semibold">{o.code}</td>
                      <td className="text-ink-500 whitespace-nowrap">{dateTime(o.created_at)}</td>
                      <td>{o.customer_name ? <><div>{o.customer_name}</div><div className="text-xs text-ink-400">{o.customer_phone}</div></> : <span className="text-ink-300">Khách lẻ</span>}</td>
                      <td className="max-w-[260px] truncate text-ink-600" title={o.items_text}>{o.items_text}</td>
                      <td className="num font-semibold">{money(o.total)}</td>
                      <td className="num">{d > 0 && o.status !== 'cancelled' ? <span className="text-red-600">{money(d)}</span> : '—'}</td>
                      <td className="text-xs text-ink-500">{(o.methods ?? '').split(',').filter(Boolean).map((m: string) => LABELS.method[m]).join(', ')}</td>
                      <td><Badge tone={ORDER_TONE[o.status]}>{LABELS.orderStatus[o.status]}</Badge></td>
                      <td className="text-ink-500 text-xs">{o.created_by_name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} pageSize={20} total={data.total} onChange={setPage} />
          </div>
        )}
      </div>
      {openId && <OrderDetail id={openId} canCancel={can('orders.cancel')} canReturn={can('orders.return')} onClose={() => { setOpenId(null); if (sp.get('open')) setSp({}); }} onChanged={reload} />}
    </div>
  );
}

export function OrderDetail({ id, onClose, onChanged, canCancel, canReturn }: { id: number; onClose: () => void; onChanged: () => void; canCancel: boolean; canReturn: boolean }) {
  const { settings } = useAuth();
  const { toast, confirm } = useUi();
  const { data: o, loading, reload } = useFetch(() => api.get(`/orders/${id}`), [id]);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { busy, run } = useSubmit();

  const print = async () => {
    try {
      await printReceiptDevice(o, settings, { reprint: o.print_count > 0 });
      await api.post(`/orders/${o.id}/printed`);
      reload();
    } catch (e) { toast.error(e); }
  };
  const cancel = async () => {
    const reason = await confirm({ title: `Hủy đơn ${o.code}?`, danger: true, confirmText: 'Hủy đơn', message: 'Hàng sẽ được nhập lại kho, phiếu bảo hành bị vô hiệu và phiếu chi hoàn tiền được tạo tự động. Thao tác được ghi vào lịch sử.', input: { label: 'Lý do hủy', required: true } });
    if (!reason) return;
    if (await run(() => api.post(`/orders/${o.id}/cancel`, { reason }), 'Đã hủy đơn hàng')) { reload(); onChanged(); }
  };
  const debt = o ? Math.max(0, o.total - o.refunded_amount - o.paid_amount) : 0;

  return (
    <Modal open size="lg" onClose={onClose} title={o ? <span className="flex items-center gap-2">Đơn hàng {o.code} <Badge tone={ORDER_TONE[o.status]}>{LABELS.orderStatus[o.status]}</Badge></span> : 'Đơn hàng'}
      subtitle={o ? `${dateTime(o.created_at)} · ${o.warehouse_name}` : undefined}
      footer={o && <>
        {canCancel && o.status === 'completed' && <button className="btn-outline text-red-600 mr-auto" onClick={cancel} disabled={busy}><Ban size={15} /> Hủy đơn</button>}
        {canReturn && ['completed', 'partial_returned'].includes(o.status) && <button className="btn-outline" onClick={() => setReturning(true)}><RotateCcw size={15} /> Trả hàng</button>}
        <button className="btn-outline" onClick={() => printerService.downloadPdf(receiptJob(o, settings)).catch(toast.error)}><FileDown size={15} /> PDF</button>
        <button className="btn-primary" onClick={() => print()}><Printer size={15} /> {o.print_count > 0 ? 'In lại hóa đơn' : 'In hóa đơn'}</button>
      </>}>
      {loading && !o ? <Loading /> : o && (
        <div className="space-y-5">
          <div className="grid md:grid-cols-2 gap-x-8">
            <div>
              <InfoRow label="Khách hàng">{o.customer_name ? `${o.customer_name} (${o.customer_phone ?? '—'})` : 'Khách lẻ'}</InfoRow>
              <InfoRow label="Người tạo đơn">{o.created_by_name}</InfoRow>
              <InfoRow label="Người sửa gần nhất">{o.updated_by_name} · {dateTime(o.updated_at)}</InfoRow>
              <InfoRow label="Số lần in">{o.print_count}</InfoRow>
            </div>
            <div>
              <InfoRow label="Tiền hàng">{money(o.subtotal)}</InfoRow>
              <InfoRow label="Giảm giá">{money(Number(o.discount_amount) + Number(o.promotion_amount))}{o.promotion_code ? ` (${o.promotion_code})` : ''}</InfoRow>
              <InfoRow label="Tổng thanh toán"><span className="text-lg">{money(o.total)}</span></InfoRow>
              <InfoRow label="Đã thu (ròng)">{money(o.paid_amount)}</InfoRow>
              {Number(o.refunded_amount) > 0 && <InfoRow label="Giá trị trả hàng">{money(o.refunded_amount)}</InfoRow>}
              {debt > 0 && o.status !== 'cancelled' && <InfoRow label="Còn nợ"><span className="text-red-600">{money(debt)}</span></InfoRow>}
              {o.cost_total != null && <InfoRow label="Giá vốn / Lãi gộp">{money(o.cost_total)} / {money(o.total - o.cost_total)}</InfoRow>}
            </div>
          </div>
          {o.cancel_reason && <div className="rounded-xl bg-red-50 text-red-700 text-sm px-4 py-3">Lý do hủy: {o.cancel_reason}</div>}
          <div className="table-wrap border border-ivory-300 rounded-xl">
            <table className="tbl">
              <thead><tr><th>Sản phẩm</th><th>Serial</th><th className="num">SL</th><th className="num">Đơn giá</th><th className="num">Giảm</th><th className="num">Thành tiền</th><th className="num">Đã trả</th></tr></thead>
              <tbody>{o.items.map((i: any) => (
                <tr key={i.id}><td><div className="font-medium">{i.product_name}</div><div className="text-xs text-ink-400">{i.sku}</div></td><td className="text-gold-700">{i.serial_number ?? '—'}</td>
                  <td className="num">{i.quantity}</td><td className="num">{money(i.unit_price)}</td><td className="num">{Number(i.discount) ? money(i.discount) : '—'}</td><td className="num font-semibold">{money(i.line_total)}</td><td className="num">{i.returned_qty || '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-2">Thanh toán</h4>
              {o.payments.length === 0 ? <div className="text-sm text-ink-400">Chưa thu tiền</div> : o.payments.map((p: any) => <InfoRow key={p.id} label={LABELS.method[p.method]}>{money(p.amount)}</InfoRow>)}
              {o.returns.length > 0 && <>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mt-4 mb-2">Lịch sử trả hàng</h4>
                {o.returns.map((r: any) => <InfoRow key={r.id} label={`${r.code} · ${dateTime(r.created_at)}`}>{money(r.refund_amount)} – {r.reason} ({r.created_by_name})</InfoRow>)}
              </>}
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-2">Bảo hành</h4>
              {o.warranties.length === 0 ? <div className="text-sm text-ink-400">Không có</div> : o.warranties.map((w: any) => (
                <InfoRow key={w.id} label={`${w.code} · ${w.serial_number}`}>{w.status === 'void' ? <Badge tone="red">Đã hủy</Badge> : `đến ${new Date(w.end_date).toLocaleDateString('vi-VN')}`}</InfoRow>
              ))}
              <Field label="Ghi chú đơn hàng" className="mt-4">
                <div className="flex gap-2">
                  <input className="input" value={note ?? o.note ?? ''} onChange={(e) => setNote(e.target.value)} />
                  {note !== null && note !== (o.note ?? '') && <button className="btn-primary btn-icon w-10" disabled={busy} onClick={async () => { if (await run(() => api.put(`/orders/${o.id}`, { note }), 'Đã lưu ghi chú')) { setNote(null); reload(); } }}><Save size={15} /></button>}
                </div>
              </Field>
            </div>
          </div>
        </div>
      )}
      {returning && o && <ReturnModal order={o} onClose={() => setReturning(false)} onDone={() => { setReturning(false); reload(); onChanged(); }} />}
    </Modal>
  );
}

function ReturnModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('cash');
  const { busy, run } = useSubmit();
  const ratio = order.subtotal > 0 ? (order.subtotal - order.discount_amount - order.promotion_amount) / order.subtotal : 0;
  const est = order.items.reduce((s: number, i: any) => s + Math.round((i.line_total / i.quantity) * (qty[i.id] || 0) * ratio), 0);
  const items = Object.entries(qty).filter(([, v]) => v > 0).map(([k, v]) => ({ order_item_id: Number(k), quantity: v }));
  return (
    <Modal open title={`Trả hàng – ${order.code}`} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button>
        <button className="btn-primary" disabled={busy || !items.length || !reason.trim()} onClick={async () => { if (await run(() => api.post(`/orders/${order.id}/return`, { items, reason, refund_method: method }), 'Đã tạo phiếu trả hàng')) onDone(); }}>Xác nhận trả hàng</button></>}>
      <div className="space-y-3">
        {order.items.map((i: any) => {
          const left = i.quantity - i.returned_qty;
          return (
            <div key={i.id} className="flex items-center gap-3 rounded-xl border border-ivory-300 px-3 py-2.5">
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{i.product_name}</div><div className="text-xs text-ink-400">{i.serial_number ? `Serial ${i.serial_number} · ` : ''}Còn trả được: {left}</div></div>
              {i.serial_id ? <input type="checkbox" disabled={left < 1} checked={!!qty[i.id]} onChange={(e) => setQty({ ...qty, [i.id]: e.target.checked ? 1 : 0 })} className="w-5 h-5 accent-amber-600" />
                : <input className="input h-9 w-20 text-center" type="number" min={0} max={left} value={qty[i.id] || 0} onChange={(e) => setQty({ ...qty, [i.id]: Math.max(0, Math.min(left, Number(e.target.value))) })} />}
            </div>
          );
        })}
        <Field label="Lý do trả hàng" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Hình thức hoàn tiền"><Select value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: 'cash', label: 'Tiền mặt' }, { value: 'transfer', label: 'Chuyển khoản' }]} /></Field>
        <div className="rounded-xl bg-ivory-100 px-4 py-3 text-sm flex justify-between"><span>Giá trị hoàn (ước tính, đã phân bổ giảm giá)</span><b>{money(est)}</b></div>
        <p className="text-xs text-ink-400">Hàng trả được nhập lại kho với lịch sử giao dịch; đồng hồ đã bán chuyển tình trạng "Đã qua sử dụng" và phiếu bảo hành tương ứng bị hủy.</p>
      </div>
    </Modal>
  );
}

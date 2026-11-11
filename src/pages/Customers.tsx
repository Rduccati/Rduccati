import { useEffect, useState } from 'react';
import { Cake, Edit3, FileSpreadsheet, MessageSquarePlus, Plus, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, LABELS, money } from '../lib/format';
import { Badge, Empty, ErrorBox, Field, InfoRow, Loading, Modal, MoneyInput, PageHeader, Pagination, SearchInput, Select, StatCard, Tabs, Textarea, useFetch, useSubmit, useUi } from '../components/ui';
import CustomerForm from '../components/CustomerForm';
import { OrderDetail, ORDER_TONE } from './Orders';

const GROUP_TONE: Record<string, string> = { normal: 'gray', silver: 'blue', gold: 'gold', vip: 'dark' };

export default function Customers() {
  const { can } = useAuth();
  const { toast } = useUi();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [bmonth, setBmonth] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => api.get('/customers', { q, group, birthday_month: bmonth, sort, page, pageSize: 25 }), [q, group, bmonth, sort, page]);
  useEffect(() => setPage(1), [q, group, bmonth, sort]);
  const [editing, setEditing] = useState<any>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  return (
    <div>
      <PageHeader title="Khách hàng" subtitle={data ? `${data.total} khách hàng` : undefined}
        actions={<>
          <button className="btn-outline" onClick={() => api.download('/customers/export.xlsx').catch(toast.error)}><FileSpreadsheet size={16} /> Xuất danh sách</button>
          {can('customers.edit') && <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Thêm khách hàng</button>}
        </>} />
      <div className="card">
        <div className="p-4 flex flex-wrap gap-3 border-b border-ivory-200">
          <SearchInput className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Tên, SĐT, mã KH, email" />
          <Select className="w-auto" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Tất cả nhóm" options={Object.entries(LABELS.group).map(([value, label]) => ({ value, label }))} />
          <Select className="w-auto" value={bmonth} onChange={(e) => setBmonth(e.target.value)} placeholder="Sinh nhật: mọi tháng" options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `Sinh nhật tháng ${i + 1}` }))} />
          <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value)} options={[{ value: '', label: 'Mới nhất' }, { value: 'spent', label: 'Chi tiêu nhiều nhất' }]} />
        </div>
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : data && (data.rows.length === 0 ? <Empty icon={<Users size={22} />} title="Chưa có khách hàng" /> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Khách hàng</th><th>Điện thoại</th><th>Nhóm</th><th>Sinh nhật</th><th className="num">Số lần mua</th><th className="num">Tổng chi tiêu</th><th className="num">Công nợ</th><th>Mua gần nhất</th></tr></thead>
            <tbody>{data.rows.map((c: any) => (
              <tr key={c.id} className="clickable" onClick={() => setViewId(c.id)}>
                <td><div className="font-medium">{c.name}</div><div className="text-xs text-ink-400">{c.code}</div></td><td>{c.phone ?? '—'}</td>
                <td><Badge tone={GROUP_TONE[c.customer_group]}>{LABELS.group[c.customer_group]}</Badge></td><td className="text-ink-500">{date(c.birthday)}</td>
                <td className="num">{c.order_count}</td><td className="num font-semibold">{money(c.total_spent)}</td><td className="num">{c.debt > 0 ? <span className="text-red-600">{money(c.debt)}</span> : '—'}</td><td className="text-ink-500">{date(c.last_order_at)}</td>
              </tr>
            ))}</tbody></table>
            <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} /></div>
        ))}
      </div>
      {editing && <Modal open title={editing.id ? 'Sửa khách hàng' : 'Thêm khách hàng'} onClose={() => setEditing(null)}><CustomerForm initial={editing} onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} /></Modal>}
      {viewId && <CustomerDetail id={viewId} onClose={() => setViewId(null)} onEdit={(c) => { setViewId(null); setEditing(c); }} onChanged={reload} />}
    </div>
  );
}

function CustomerDetail({ id, onClose, onEdit, onChanged }: { id: number; onClose: () => void; onEdit: (c: any) => void; onChanged: () => void }) {
  const { can } = useAuth();
  const { confirm, toast } = useUi();
  const { data: c, loading, reload } = useFetch(() => api.get(`/customers/${id}`), [id]);
  const [tab, setTab] = useState<'orders' | 'care' | 'warranty' | 'debt'>('orders');
  const [care, setCare] = useState({ care_type: 'call', content: '', next_care_date: '' });
  const [pay, setPay] = useState({ amount: 0, method: 'cash' });
  const [orderId, setOrderId] = useState<number | null>(null);
  const { busy, run } = useSubmit();
  const remove = async () => {
    if (!(await confirm({ title: `Xóa khách hàng ${c.name}?`, danger: true, confirmText: 'Xóa' }))) return;
    try { await api.del(`/customers/${c.id}`); toast.success('Đã xóa khách hàng'); onChanged(); onClose(); } catch (e) { toast.error(e); }
  };
  return (
    <Modal open size="xl" onClose={onClose} title={c ? <span className="flex items-center gap-2">{c.name} <Badge tone={GROUP_TONE[c.customer_group]}>{LABELS.group[c.customer_group]}</Badge></span> : 'Khách hàng'} subtitle={c?.code}
      footer={c && can('customers.edit') && <><button className="btn-outline text-red-600 mr-auto" onClick={remove}><Trash2 size={15} /> Xóa</button><button className="btn-primary" onClick={() => onEdit(c)}><Edit3 size={15} /> Sửa hồ sơ</button></>}>
      {loading && !c ? <Loading /> : c && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Tổng chi tiêu" value={money(c.total_spent)} tone="dark" />
            <StatCard label="Số lần mua" value={c.order_count} />
            <StatCard label="Công nợ" value={<span className={c.debt > 0 ? 'text-red-600' : ''}>{money(c.debt)}</span>} />
            <StatCard label="Mua gần nhất" value={<span className="text-base">{date(c.last_order_at)}</span>} />
          </div>
          <div className="grid md:grid-cols-2 gap-x-8">
            <div><InfoRow label="Điện thoại">{c.phone}</InfoRow><InfoRow label="Email">{c.email}</InfoRow><InfoRow label="Địa chỉ">{c.address}</InfoRow></div>
            <div><InfoRow label="Ngày sinh"><span className="inline-flex items-center gap-1">{c.birthday && <Cake size={13} className="text-gold-500" />}{date(c.birthday)}</span></InfoRow><InfoRow label="Sở thích">{c.preferences}</InfoRow><InfoRow label="Ghi chú">{c.note}</InfoRow></div>
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'orders', label: 'Lịch sử mua hàng', count: c.orders.length }, { value: 'care', label: 'Chăm sóc', count: c.care.length }, { value: 'warranty', label: 'Bảo hành & sửa chữa', count: c.warranties.length + c.repairs.length }, { value: 'debt', label: 'Công nợ' }]} />
          {tab === 'orders' && (c.orders.length === 0 ? <Empty title="Chưa mua hàng" /> : (
            <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Mã đơn</th><th>Ngày</th><th>Sản phẩm</th><th className="num">Tổng</th><th>Trạng thái</th></tr></thead>
              <tbody>{c.orders.map((o: any) => <tr key={o.id} className="clickable" onClick={() => setOrderId(o.id)}><td className="font-semibold">{o.code}</td><td>{dateTime(o.created_at)}</td><td className="max-w-[300px] truncate">{o.items}</td><td className="num">{money(o.total)}</td><td><Badge tone={ORDER_TONE[o.status]}>{LABELS.orderStatus[o.status]}</Badge></td></tr>)}</tbody></table></div>
          ))}
          {tab === 'care' && (
            <div className="space-y-4">
              {can('customers.edit') && (
                <div className="rounded-2xl bg-ivory-100 p-4 grid sm:grid-cols-[150px_1fr_160px_auto] gap-3 items-end">
                  <Field label="Hình thức"><Select value={care.care_type} onChange={(e) => setCare({ ...care, care_type: e.target.value })} options={Object.entries(LABELS.careType).map(([value, label]) => ({ value, label }))} /></Field>
                  <Field label="Nội dung"><input className="input" value={care.content} onChange={(e) => setCare({ ...care, content: e.target.value })} /></Field>
                  <Field label="Hẹn chăm sóc tiếp"><input className="input" type="date" value={care.next_care_date} onChange={(e) => setCare({ ...care, next_care_date: e.target.value })} /></Field>
                  <button className="btn-primary" disabled={busy || !care.content.trim()} onClick={async () => { if (await run(() => api.post(`/customers/${c.id}/care`, care), 'Đã ghi nhận')) { setCare({ care_type: 'call', content: '', next_care_date: '' }); reload(); } }}><MessageSquarePlus size={15} /> Ghi nhận</button>
                </div>
              )}
              {c.care.length === 0 ? <Empty title="Chưa có lịch sử chăm sóc" /> : (
                <ul className="space-y-2">{c.care.map((l: any) => (
                  <li key={l.id} className="rounded-xl border border-ivory-300 px-4 py-3 flex gap-3">
                    <Badge tone="gold">{LABELS.careType[l.care_type]}</Badge>
                    <div className="flex-1 text-sm"><div>{l.content}</div><div className="text-xs text-ink-400 mt-0.5">{l.user_name} · {dateTime(l.created_at)}{l.next_care_date && ` · Hẹn tiếp: ${date(l.next_care_date)}`}</div></div>
                    {can('customers.edit') && <button className="text-ink-300 hover:text-red-600" onClick={async () => { await api.del(`/customers/${c.id}/care/${l.id}`); reload(); }}><Trash2 size={14} /></button>}
                  </li>
                ))}</ul>
              )}
            </div>
          )}
          {tab === 'warranty' && (
            <div className="grid md:grid-cols-2 gap-5">
              <div><h4 className="label">Phiếu bảo hành</h4>{c.warranties.length === 0 ? <div className="text-sm text-ink-400">Không có</div> : c.warranties.map((w: any) => <InfoRow key={w.id} label={`${w.code} · ${w.product_name}`}>{w.status === 'void' ? <Badge tone="red">Đã hủy</Badge> : `đến ${date(w.end_date)}`}</InfoRow>)}</div>
              <div><h4 className="label">Phiếu sửa chữa</h4>{c.repairs.length === 0 ? <div className="text-sm text-ink-400">Không có</div> : c.repairs.map((r: any) => <InfoRow key={r.id} label={`${r.code} · ${[r.watch_brand, r.watch_model].filter(Boolean).join(' ')}`}>{LABELS.repairStatus[r.status]}</InfoRow>)}</div>
            </div>
          )}
          {tab === 'debt' && (
            <div className="space-y-4">
              <div className="text-sm">Công nợ hiện tại: <b className={c.debt > 0 ? 'text-red-600' : ''}>{money(c.debt)}</b> (nợ đầu kỳ {money(c.opening_debt)} + nợ từ đơn hàng – đã thu nợ)</div>
              {c.debt > 0 && can('finance.edit') && (
                <div className="rounded-2xl bg-ivory-100 p-4 flex flex-wrap gap-3 items-end">
                  <Field label="Số tiền thu nợ"><MoneyInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: Math.min(v, c.debt) })} /></Field>
                  <Field label="Hình thức"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} options={[{ value: 'cash', label: 'Tiền mặt' }, { value: 'transfer', label: 'Chuyển khoản' }]} /></Field>
                  <button className="btn-primary" disabled={busy || pay.amount <= 0} onClick={async () => { if (await run(() => api.post('/finance/transactions', { tx_type: 'receipt', category: 'customer_debt', method: pay.method, amount: pay.amount, customer_id: c.id, note: `Thu nợ khách ${c.name}` }), 'Đã lập phiếu thu nợ')) { setPay({ amount: 0, method: 'cash' }); reload(); onChanged(); } }}>Lập phiếu thu</button>
                </div>
              )}
              {c.payments.length > 0 && <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Phiếu</th><th>Ngày</th><th>Hình thức</th><th className="num">Số tiền</th></tr></thead>
                <tbody>{c.payments.map((p: any) => <tr key={p.id}><td>{p.code}</td><td>{dateTime(p.created_at)}</td><td>{LABELS.method[p.method]}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table></div>}
            </div>
          )}
        </div>
      )}
      {orderId && <OrderDetail id={orderId} onClose={() => setOrderId(null)} onChanged={reload} canCancel={can('orders.cancel')} canReturn={can('orders.return')} />}
    </Modal>
  );
}


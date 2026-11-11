import { useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, FileSpreadsheet, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, dateTime, LABELS, money, today } from '../lib/format';
import { Badge, DateRange, Empty, ErrorBox, Field, Loading, Modal, MoneyInput, PageHeader, Pagination, SearchInput, Select, StatCard, Tabs, cx, useFetch, useSubmit, useUi } from '../components/ui';

export default function Finance() {
  const [tab, setTab] = useState<'cashbook' | 'debts' | 'shifts'>('cashbook');
  const [creating, setCreating] = useState<'receipt' | 'payment' | null>(null);
  const [v, setV] = useState(0);
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Thu chi & Sổ quỹ" subtitle="Dòng tiền thực thu/chi – tách biệt với doanh thu và lợi nhuận"
        actions={can('finance.edit') && <>
          <button className="btn-outline" onClick={() => setCreating('receipt')}><ArrowDownCircle size={16} className="text-emerald-600" /> Lập phiếu thu</button>
          <button className="btn-primary" onClick={() => setCreating('payment')}><ArrowUpCircle size={16} /> Lập phiếu chi</button>
        </>} />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ value: 'cashbook', label: 'Sổ quỹ' }, { value: 'debts', label: 'Công nợ' }, { value: 'shifts', label: 'Ca bán hàng & đối soát' }]} />
      <div key={v}>
        {tab === 'cashbook' && <Cashbook />}
        {tab === 'debts' && <Debts />}
        {tab === 'shifts' && <Shifts />}
      </div>
      {creating && <TxForm type={creating} onClose={() => setCreating(null)} onDone={() => { setCreating(null); setV(v + 1); }} />}
    </div>
  );
}

function Cashbook() {
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const [from, setFrom] = useState(addDays(today(), -29));
  const [to, setTo] = useState(today());
  const [f, setF] = useState({ type: '', method: '', category: '', q: '' });
  const [page, setPage] = useState(1);
  const { data: cats } = useFetch(() => api.get('/finance/categories'), []);
  const { data: sum } = useFetch(() => api.get('/finance/summary', { from, to }), [from, to]);
  const { data, loading, error, reload } = useFetch(() => api.get('/finance/transactions', { ...f, from, to, page, pageSize: 30 }), [f, from, to, page]);
  useEffect(() => setPage(1), [f, from, to]);
  const del = async (t: any) => {
    if (!(await confirm({ title: `Xóa phiếu ${t.code}?`, danger: true, message: 'Chỉ xóa được phiếu lập tay. Thao tác được ghi lịch sử.' }))) return;
    try { await api.del(`/finance/transactions/${t.id}`); toast.success('Đã xóa phiếu'); reload(); } catch (e) { toast.error(e); }
  };
  return (
    <>
      {sum && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {(['cash', 'transfer'] as const).map((m) => (
            <div key={m} className={cx('rounded-2xl p-5 border', m === 'cash' ? 'bg-ink-900 text-ivory-50 border-ink-800' : 'bg-white border-ivory-300')}>
              <div className={cx('text-[11px] font-semibold uppercase tracking-[0.12em]', m === 'cash' ? 'text-gold-300' : 'text-ink-400')}>{m === 'cash' ? 'Quỹ tiền mặt' : 'Tài khoản ngân hàng'}</div>
              <div className="text-2xl font-semibold tabular-nums mt-1">{money(sum[m].closing)}</div>
              <div className={cx('grid grid-cols-3 gap-2 text-xs mt-3', m === 'cash' ? 'text-ink-300' : 'text-ink-500')}>
                <div>Đầu kỳ<div className="font-semibold tabular-nums text-sm">{money(sum[m].opening)}</div></div>
                <div>Thu<div className="font-semibold tabular-nums text-sm text-emerald-500">+{money(sum[m].receipt)}</div></div>
                <div>Chi<div className="font-semibold tabular-nums text-sm text-red-400">-{money(sum[m].payment)}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <div className="p-4 flex flex-wrap gap-3 border-b border-ivory-200">
          <SearchInput className="w-full sm:w-56" value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Mã phiếu, diễn giải, đối tượng" />
          <Select className="w-auto" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} placeholder="Thu & chi" options={[{ value: 'receipt', label: 'Phiếu thu' }, { value: 'payment', label: 'Phiếu chi' }]} />
          <Select className="w-auto" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder="Mọi hình thức" options={Object.entries(LABELS.method).map(([value, label]) => ({ value, label }))} />
          <Select className="w-auto" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Mọi hạng mục" options={Object.entries(cats?.labels ?? {}).map(([value, label]) => ({ value, label: label as string }))} />
          <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
          <button className="btn-outline" onClick={() => api.download('/finance/transactions', { ...f, from, to, format: 'xlsx' }).catch(toast.error)}><FileSpreadsheet size={16} /> Excel</button>
        </div>
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : data && (data.rows.length === 0 ? <Empty title="Không có phiếu thu chi" /> : (
          <div className="table-wrap">
            <div className="px-4 py-2.5 text-sm bg-ivory-100 flex gap-6"><span>Tổng thu: <b className="text-emerald-700">{money(data.receipt)}</b></span><span>Tổng chi: <b className="text-red-600">{money(data.payment)}</b></span><span>Chênh lệch: <b>{money(data.receipt - data.payment)}</b></span></div>
            <table className="tbl">
              <thead><tr><th>Mã phiếu</th><th>Thời gian</th><th>Hạng mục</th><th>Đối tượng</th><th>Diễn giải</th><th>Hình thức</th><th className="num">Số tiền</th><th>Người lập</th><th></th></tr></thead>
              <tbody>{data.rows.map((t: any) => (
                <tr key={t.id}>
                  <td className="font-mono font-semibold">{t.code}</td><td className="whitespace-nowrap text-ink-500">{dateTime(t.created_at)}</td>
                  <td><Badge tone={t.tx_type === 'receipt' ? 'green' : 'red'}>{cats?.labels?.[t.category] ?? t.category}</Badge></td>
                  <td>{t.customer_name || t.supplier_name || t.payer_name || '—'}</td><td className="max-w-[240px] truncate text-ink-600" title={t.note}>{t.note}</td><td>{LABELS.method[t.method]}</td>
                  <td className={cx('num font-semibold', t.tx_type === 'receipt' ? 'text-emerald-700' : 'text-red-600')}>{t.tx_type === 'receipt' ? '+' : '-'}{money(t.amount)}</td>
                  <td className="text-ink-500 text-xs">{t.created_by_name}</td>
                  <td>{can('finance.edit') && !t.ref_type && <button className="btn-ghost btn-icon w-8 h-8 hover:text-red-600" onClick={() => del(t)}><Trash2 size={14} /></button>}</td>
                </tr>
              ))}</tbody></table>
            <Pagination page={page} pageSize={30} total={data.total} onChange={setPage} />
          </div>
        ))}
      </div>
    </>
  );
}

function TxForm({ type, onClose, onDone }: { type: 'receipt' | 'payment'; onClose: () => void; onDone: () => void }) {
  const { data: cats } = useFetch(() => api.get('/finance/categories'), []);
  const { data: suppliers } = useFetch(() => api.get('/suppliers'), []);
  const [f, setF] = useState<any>({ tx_type: type, category: type === 'receipt' ? 'other_income' : 'other_expense', method: 'cash', amount: 0, customer_id: '', supplier_id: '', payer_name: '', note: '' });
  const [cq, setCq] = useState('');
  const [cs, setCs] = useState<any[]>([]);
  useEffect(() => { if (!cq) return; const t = setTimeout(() => api.get('/customers', { q: cq, pageSize: 6 }).then((r) => setCs(r.rows)), 200); return () => clearTimeout(t); }, [cq]);
  const { busy, run } = useSubmit();
  const list: string[] = cats ? (type === 'receipt' ? cats.receipt : cats.payment) : [];
  const needSupplier = ['supplier_payment', 'supplier_refund'].includes(f.category);
  const needCustomer = f.category === 'customer_debt';
  return (
    <Modal open title={type === 'receipt' ? 'Lập phiếu thu' : 'Lập phiếu chi'} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => api.post('/finance/transactions', { ...f, customer_id: f.customer_id || null, supplier_id: f.supplier_id || null }), 'Đã lập phiếu')) onDone(); }}>Lưu phiếu</button></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Hạng mục"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={list.map((c) => ({ value: c, label: cats.labels[c] }))} /></Field>
        <Field label="Hình thức"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={Object.entries(LABELS.method).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Số tiền" required><MoneyInput autoFocus value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        {needSupplier ? <Field label="Nhà cung cấp" required><Select value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })} placeholder="— Chọn —" options={(suppliers ?? []).map((s: any) => ({ value: s.id, label: `${s.name} (nợ ${money(s.debt)})` }))} /></Field>
          : needCustomer ? <Field label="Khách hàng" required>
            <input className="input" placeholder="Tìm tên / SĐT" value={cq} onChange={(e) => { setCq(e.target.value); setF({ ...f, customer_id: '' }); }} />
            {cs.length > 0 && !f.customer_id && <div className="mt-1 border border-ivory-300 rounded-xl overflow-hidden">{cs.map((c) => <button key={c.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-gold-50" onClick={() => { setF({ ...f, customer_id: c.id }); setCq(`${c.name} (nợ ${money(c.debt)})`); setCs([]); }}>{c.name} · {c.phone} · nợ {money(c.debt)}</button>)}</div>}
          </Field>
          : <Field label={type === 'receipt' ? 'Người nộp' : 'Người nhận'}><input className="input" value={f.payer_name} onChange={(e) => setF({ ...f, payer_name: e.target.value })} /></Field>}
        <Field label="Diễn giải" className="sm:col-span-2"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-ink-400 mt-4">Phiếu tiền mặt tự gắn vào ca bán hàng đang mở của bạn để đối soát cuối ca. Chi phí (thuê, lương, điện nước...) được trừ vào lợi nhuận ròng; trả nợ NCC/rút quỹ chỉ ảnh hưởng dòng tiền.</p>
    </Modal>
  );
}

function Debts() {
  const { data, loading } = useFetch(() => api.get('/finance/debts'), []);
  if (loading || !data) return <Loading />;
  const sc = data.customers.reduce((s: number, c: any) => s + c.debt, 0);
  const ss = data.suppliers.reduce((s: number, c: any) => s + c.debt, 0);
  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-3 gap-4">
        <StatCard label="Khách hàng nợ (phải thu)" value={money(sc)} sub={`${data.customers.length} khách`} />
        <StatCard label="Nợ nhà cung cấp (phải trả)" value={money(ss)} sub={`${data.suppliers.length} nhà cung cấp`} />
        <StatCard label="Phải trả người ký gửi" value={money(data.consignment_payable)} sub={`${data.consignment_count} chiếc đã bán chưa thanh toán`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card"><div className="px-5 py-4 border-b border-ivory-200 font-semibold">Công nợ khách hàng</div>
          {data.customers.length === 0 ? <Empty title="Không có công nợ" /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>Khách hàng</th><th>SĐT</th><th className="num">Còn nợ</th></tr></thead>
            <tbody>{data.customers.map((c: any) => <tr key={c.id}><td>{c.name}<div className="text-xs text-ink-400">{c.code}</div></td><td>{c.phone}</td><td className="num font-semibold text-red-600">{money(c.debt)}</td></tr>)}</tbody></table></div>}
        </div>
        <div className="card"><div className="px-5 py-4 border-b border-ivory-200 font-semibold">Công nợ nhà cung cấp</div>
          {data.suppliers.length === 0 ? <Empty title="Không có công nợ" /> : <div className="table-wrap"><table className="tbl"><thead><tr><th>Nhà cung cấp</th><th>SĐT</th><th className="num">Phải trả</th></tr></thead>
            <tbody>{data.suppliers.map((c: any) => <tr key={c.id}><td>{c.name}<div className="text-xs text-ink-400">{c.code}</div></td><td>{c.phone}</td><td className="num font-semibold">{money(c.debt)}</td></tr>)}</tbody></table></div>}
        </div>
      </div>
      <p className="text-xs text-ink-400">Thu nợ khách / trả nợ NCC: mở chi tiết khách hàng hoặc nhà cung cấp, hoặc lập phiếu thu/chi với hạng mục tương ứng.</p>
    </div>
  );
}

function Shifts() {
  const { data, loading } = useFetch(() => api.get('/shifts'), []);
  const [view, setView] = useState<number | null>(null);
  if (loading || !data) return <Loading />;
  return (
    <div className="card">
      {data.length === 0 ? <Empty title="Chưa có ca bán hàng">Nhân viên mở ca tại màn hình POS (góc dưới bên phải).</Empty> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Ca</th><th>Nhân viên</th><th>Mở ca</th><th>Đóng ca</th><th className="num">Số đơn</th><th className="num">Doanh thu</th><th className="num">Tiền mặt dự kiến</th><th className="num">Thực đếm</th><th className="num">Chênh lệch</th></tr></thead>
          <tbody>{data.map((s: any) => (
            <tr key={s.id} className="clickable" onClick={() => setView(s.id)}><td className="font-mono font-semibold">{s.code} {s.status === 'open' && <Badge tone="green">Đang mở</Badge>}</td><td>{s.user_name}</td><td className="whitespace-nowrap">{dateTime(s.opened_at)}</td><td className="whitespace-nowrap">{dateTime(s.closed_at)}</td>
              <td className="num">{s.order_count}</td><td className="num">{money(s.revenue)}</td><td className="num">{s.expected_cash != null ? money(s.expected_cash) : '—'}</td><td className="num">{s.counted_cash != null ? money(s.counted_cash) : '—'}</td>
              <td className={cx('num font-semibold', s.difference ? 'text-red-600' : 'text-emerald-700')}>{s.difference != null ? money(s.difference) : '—'}</td></tr>
          ))}</tbody></table></div>
      )}
      {view && <ShiftDetail id={view} onClose={() => setView(null)} />}
    </div>
  );
}

function ShiftDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: s } = useFetch(() => api.get(`/shifts/${id}`), [id]);
  const { data: cats } = useFetch(() => api.get('/finance/categories'), []);
  return (
    <Modal open title={s ? `Tổng kết ca ${s.code}` : 'Ca bán hàng'} subtitle={s ? `${s.user_name} · ${dateTime(s.opened_at)} → ${s.closed_at ? dateTime(s.closed_at) : 'đang mở'}` : ''} onClose={onClose}>
      {!s ? <Loading /> : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Số đơn" value={s.order_count} /><StatCard label="Doanh thu" value={money(s.revenue)} /><StatCard label="Chuyển khoản" value={money(s.transfer_in)} /><StatCard label="Thẻ" value={money(s.card_in)} />
          </div>
          <div className="rounded-xl bg-ivory-100 p-4 space-y-1.5">
            <div className="flex justify-between"><span>Tiền đầu ca</span><b>{money(s.opening_cash)}</b></div>
            <div className="flex justify-between"><span>+ Thu tiền mặt</span><b>{money(s.cash_in)}</b></div>
            <div className="flex justify-between"><span>– Chi tiền mặt</span><b>{money(s.cash_out)}</b></div>
            <div className="flex justify-between border-t border-ivory-300 pt-1.5"><span>Tiền mặt dự kiến</span><b>{money(s.expected_cash ?? s.expected_cash_now)}</b></div>
            {s.counted_cash != null && <><div className="flex justify-between"><span>Thực đếm</span><b>{money(s.counted_cash)}</b></div>
              <div className={cx('flex justify-between font-semibold', s.difference ? 'text-red-600' : 'text-emerald-700')}><span>Chênh lệch</span><span>{money(s.difference)}</span></div></>}
          </div>
          <table className="tbl"><thead><tr><th>Loại</th><th>Hạng mục</th><th>Hình thức</th><th className="num">Số phiếu</th><th className="num">Số tiền</th></tr></thead>
            <tbody>{s.breakdown.map((b: any, i: number) => <tr key={i}><td>{b.tx_type === 'receipt' ? 'Thu' : 'Chi'}</td><td>{cats?.labels?.[b.category] ?? b.category}</td><td>{LABELS.method[b.method]}</td><td className="num">{b.n}</td><td className="num">{money(b.amount)}</td></tr>)}</tbody></table>
        </div>
      )}
    </Modal>
  );
}

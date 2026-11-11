import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ClipboardCheck, FileSpreadsheet, HandCoins, Hourglass, Plus, SlidersHorizontal, Trash2, Wrench, PackageOpen, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, date, dateTime, LABELS, money, today } from '../lib/format';
import { Badge, DateRange, Empty, ErrorBox, Field, InfoRow, Loading, Modal, MoneyInput, PageHeader, Pagination, SearchInput, Select, StatCard, Tabs, Textarea, cx, useFetch, useSubmit, useUi } from '../components/ui';
import ProductPicker from '../components/ProductPicker';

type Tab = 'stock' | 'docs' | 'moves' | 'alerts' | 'consign' | 'repair';
const DOC_ICON: Record<string, any> = { import: ArrowDownToLine, export: ArrowUpFromLine, transfer: ArrowLeftRight, stocktake: ClipboardCheck, adjust: SlidersHorizontal, consign_in: PackageOpen, consign_return: Undo2, repair_out: Wrench, repair_in: Wrench };

export default function Inventory() {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) || 'stock');
  const { can } = useAuth();
  const [newDoc, setNewDoc] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  return (
    <div>
      <PageHeader title="Kho hàng" subtitle="Mọi thay đổi tồn kho đều qua phiếu kho và được ghi vào sổ cái bất biến"
        actions={can('inventory.edit') && <>
          <button className="btn-primary" onClick={() => setNewDoc('import')}><ArrowDownToLine size={16} /> Nhập hàng</button>
          <button className="btn-outline" onClick={() => setNewDoc('export')}><ArrowUpFromLine size={16} /> Xuất hàng</button>
          <button className="btn-outline" onClick={() => setNewDoc('transfer')}><ArrowLeftRight size={16} /> Chuyển kho</button>
          <button className="btn-outline" onClick={() => setNewDoc('stocktake')}><ClipboardCheck size={16} /> Kiểm kê</button>
          <Select className="w-auto" value="" onChange={(e) => e.target.value && setNewDoc(e.target.value)} placeholder="Phiếu khác..."
            options={[{ value: 'adjust', label: 'Điều chỉnh tồn (phụ kiện)' }, { value: 'consign_in', label: 'Nhận hàng ký gửi' }, { value: 'consign_return', label: 'Trả hàng ký gửi' }, { value: 'repair_out', label: 'Gửi hàng đi sửa chữa' }, { value: 'repair_in', label: 'Nhận hàng sửa chữa về' }]} />
        </>} />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { value: 'stock', label: 'Tồn kho' }, { value: 'docs', label: 'Phiếu kho' }, { value: 'moves', label: 'Lịch sử nhập xuất' },
        { value: 'alerts', label: 'Cảnh báo' }, { value: 'consign', label: 'Hàng ký gửi' }, { value: 'repair', label: 'Hàng đang sửa chữa' },
      ]} />
      <div key={version}>
        {tab === 'stock' && <StockTab />}
        {tab === 'docs' && <DocsTab />}
        {tab === 'moves' && <MovesTab />}
        {tab === 'alerts' && <AlertsTab />}
        {tab === 'consign' && <ConsignTab />}
        {tab === 'repair' && <RepairTab />}
      </div>
      {newDoc && <StockDocForm type={newDoc} onClose={() => setNewDoc(null)} onDone={() => { setNewDoc(null); setVersion((v) => v + 1); }} />}
    </div>
  );
}

function useWarehouses() { return useFetch(() => api.get('/warehouses'), []).data ?? []; }

function StockTab() {
  const { can } = useAuth();
  const { toast } = useUi();
  const warehouses = useWarehouses();
  const [q, setQ] = useState('');
  const [wh, setWh] = useState('');
  const [filter, setFilter] = useState('in');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => api.get('/inventory/stock', { q, warehouse_id: wh, filter, page, pageSize: 30 }), [q, wh, filter, page]);
  useEffect(() => setPage(1), [q, wh, filter]);
  return (
    <>
      {data && <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <StatCard label="Tổng số lượng tồn" value={Number(data.summary.qty).toLocaleString('vi-VN')} />
        {data.summary.value != null && <StatCard label="Giá trị tồn (giá vốn)" value={money(data.summary.value)} />}
        <StatCard label="Giá trị theo giá bán" value={money(data.summary.retail)} />
      </div>}
      <div className="card">
        <div className="p-4 flex flex-wrap gap-3 border-b border-ivory-200">
          <SearchInput className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Tên, SKU, barcode" />
          <Select className="w-auto" value={wh} onChange={(e) => setWh(e.target.value)} placeholder="Tất cả kho" options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))} />
          <Select className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} options={[{ value: 'in', label: 'Còn hàng' }, { value: 'low', label: 'Sắp hết / hết' }, { value: '', label: 'Tất cả' }]} />
          <button className="btn-outline sm:ml-auto" onClick={() => api.download('/reports/inventory', { format: 'xlsx' }).catch(toast.error)}><FileSpreadsheet size={16} /> Xuất Excel tồn kho</button>
        </div>
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : data && (data.rows.length === 0 ? <Empty title="Không có dữ liệu tồn kho" /> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Sản phẩm</th><th>SKU</th><th className="num">Tồn</th><th className="num">Ký gửi</th><th className="num">Đang sửa</th><th className="num">Định mức</th>{can('products.cost') && <th className="num">Giá trị vốn</th>}<th>Nhập gần nhất</th></tr></thead>
            <tbody>{data.rows.map((r: any) => (
              <tr key={r.id}><td><div className="font-medium">{r.name}</div><div className="text-xs text-ink-400">{r.brand_name ?? '—'}{r.track_serial ? ' · quản lý serial' : ''}</div></td><td className="font-mono text-xs">{r.sku}</td>
                <td className={cx('num font-semibold', r.quantity <= r.min_stock && 'text-amber-700', r.quantity === 0 && 'text-red-600')}>{r.quantity}</td><td className="num">{r.consign_qty || '—'}</td><td className="num">{r.repairing_qty || '—'}</td>
                <td className="num text-ink-400">{r.min_stock}</td>{can('products.cost') && <td className="num">{money(r.quantity * r.cost_price)}</td>}<td className="text-ink-500">{date(r.last_in)}</td></tr>
            ))}</tbody></table>
            <Pagination page={page} pageSize={30} total={data.total} onChange={setPage} /></div>
        ))}
      </div>
    </>
  );
}

function DocsTab() {
  const warehouses = useWarehouses();
  const [type, setType] = useState('');
  const [wh, setWh] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<number | null>(null);
  const { data, loading, error, reload } = useFetch(() => api.get('/inventory/documents', { type, warehouse_id: wh, q, page, pageSize: 25 }), [type, wh, q, page]);
  useEffect(() => setPage(1), [type, wh, q]);
  return (
    <div className="card">
      <div className="p-4 flex flex-wrap gap-3 border-b border-ivory-200">
        <SearchInput className="w-full sm:w-64" value={q} onChange={setQ} placeholder="Mã phiếu, ghi chú" />
        <Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)} placeholder="Tất cả loại phiếu" options={Object.entries(LABELS.docType).map(([value, label]) => ({ value, label }))} />
        <Select className="w-auto" value={wh} onChange={(e) => setWh(e.target.value)} placeholder="Tất cả kho" options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))} />
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && (data.rows.length === 0 ? <Empty title="Chưa có phiếu kho" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Mã phiếu</th><th>Loại</th><th>Thời gian</th><th>Kho</th><th>Đối tác</th><th className="num">SL</th><th className="num">Giá trị</th><th>Người tạo</th></tr></thead>
          <tbody>{data.rows.map((d: any) => {
            const Icon = DOC_ICON[d.doc_type] ?? ArrowDownToLine;
            return (
              <tr key={d.id} className="clickable" onClick={() => setView(d.id)}>
                <td className="font-mono font-semibold">{d.code}</td><td><span className="flex items-center gap-1.5"><Icon size={14} className="text-gold-600" />{LABELS.docType[d.doc_type]}</span></td>
                <td className="whitespace-nowrap text-ink-500">{dateTime(d.created_at)}</td><td>{d.warehouse_name}{d.to_warehouse_name && <> → {d.to_warehouse_name}</>}</td>
                <td>{d.supplier_name ?? '—'}</td><td className="num">{d.item_qty}</td><td className="num">{money(d.total_amount)}</td><td className="text-ink-500">{d.created_by_name}</td>
              </tr>
            );
          })}</tbody></table>
          <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} /></div>
      ))}
      {view && <DocDetail id={view} onClose={() => setView(null)} />}
    </div>
  );
}

function DocDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: d, loading } = useFetch(() => api.get(`/inventory/documents/${id}`), [id]);
  return (
    <Modal open size="lg" onClose={onClose} title={d ? `${d.type_label} ${d.code}` : 'Phiếu kho'} subtitle={d ? dateTime(d.created_at) : ''}>
      {loading || !d ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-x-8">
            <div><InfoRow label="Kho">{d.warehouse_name}{d.to_warehouse_name ? ` → ${d.to_warehouse_name}` : ''}</InfoRow><InfoRow label="Nhà cung cấp">{d.supplier_name}</InfoRow><InfoRow label="Người tạo">{d.created_by_name}</InfoRow></div>
            <div><InfoRow label="Tổng giá trị">{money(d.total_amount)}</InfoRow><InfoRow label="Đã thanh toán">{money(d.paid_amount)}</InfoRow><InfoRow label="Lý do / ghi chú">{[d.reason, d.note].filter(Boolean).join(' – ')}</InfoRow></div>
          </div>
          <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl">
            <thead><tr><th>Sản phẩm</th><th>Serial</th><th className="num">SL</th>{d.doc_type === 'stocktake' && <><th className="num">Hệ thống</th><th className="num">Thực tế</th></>}<th className="num">Đơn giá</th><th>Ghi chú</th></tr></thead>
            <tbody>{d.items.map((i: any) => <tr key={i.id}><td><div className="font-medium">{i.product_name}</div><div className="text-xs text-ink-400">{i.sku}</div></td><td className="font-mono text-xs">{i.serial_number ?? '—'}{i.consignor_name && <div className="text-ink-400">KG: {i.consignor_name}</div>}</td>
              <td className={cx('num font-semibold', i.quantity < 0 && 'text-red-600')}>{i.quantity}</td>{d.doc_type === 'stocktake' && <><td className="num">{i.system_qty}</td><td className="num">{i.counted_qty}</td></>}<td className="num">{money(i.unit_cost)}</td><td className="text-xs text-ink-500">{i.note}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </Modal>
  );
}

function MovesTab() {
  const { toast } = useUi();
  const warehouses = useWarehouses();
  const [q, setQ] = useState('');
  const [wh, setWh] = useState('');
  const [ref, setRef] = useState('');
  const [from, setFrom] = useState(addDays(today(), -29));
  const [to, setTo] = useState(today());
  const [page, setPage] = useState(1);
  const params = { q, warehouse_id: wh, ref_type: ref, from, to };
  const { data, loading, error, reload } = useFetch(() => api.get('/inventory/movements', { ...params, page, pageSize: 40 }), [q, wh, ref, from, to, page]);
  useEffect(() => setPage(1), [q, wh, ref, from, to]);
  return (
    <div className="card">
      <div className="p-4 flex flex-wrap gap-3 border-b border-ivory-200">
        <SearchInput className="w-full sm:w-60" value={q} onChange={setQ} placeholder="Sản phẩm, SKU, serial, chứng từ" />
        <Select className="w-auto" value={wh} onChange={(e) => setWh(e.target.value)} placeholder="Tất cả kho" options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))} />
        <Select className="w-auto" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Tất cả giao dịch" options={Object.entries(LABELS.refType).map(([value, label]) => ({ value, label }))} />
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <button className="btn-outline" onClick={() => api.download('/inventory/movements', { ...params, format: 'xlsx' }).catch(toast.error)}><FileSpreadsheet size={16} /> Excel</button>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data && (data.rows.length === 0 ? <Empty title="Không có giao dịch" /> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Thời gian</th><th>Chứng từ</th><th>Loại</th><th>Sản phẩm</th><th>Serial</th><th>Kho</th><th className="num">Thay đổi</th><th className="num">Tồn sau</th><th>Người thực hiện</th></tr></thead>
          <tbody>{data.rows.map((m: any) => (
            <tr key={m.id}><td className="whitespace-nowrap text-ink-500">{dateTime(m.created_at)}</td><td className="font-mono text-xs">{m.ref_code}</td><td>{LABELS.refType[m.ref_type] ?? m.ref_type}</td>
              <td><div className="max-w-[240px] truncate">{m.product_name}</div><div className="text-xs text-ink-400">{m.sku}</div></td><td className="font-mono text-xs">{m.serial_number ?? '—'}</td><td>{m.warehouse_name}</td>
              <td className={cx('num font-semibold', m.qty_change > 0 ? 'text-emerald-700' : 'text-red-600')}>{m.qty_change > 0 ? '+' : ''}{m.qty_change}</td><td className="num">{m.balance_after}</td><td className="text-ink-500">{m.user_name}</td></tr>
          ))}</tbody></table>
          <Pagination page={page} pageSize={40} total={data.total} onChange={setPage} /></div>
      ))}
    </div>
  );
}

function AlertsTab() {
  const { data, loading } = useFetch(() => api.get('/inventory/alerts'), []);
  const { can } = useAuth();
  if (loading || !data) return <Loading />;
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="card">
        <div className="px-5 py-4 border-b border-ivory-200 flex items-center gap-2"><AlertTriangle size={17} className="text-amber-600" /><h3 className="font-semibold">Sắp hết / hết hàng ({data.low.length})</h3></div>
        {data.low.length === 0 ? <Empty title="Không có sản phẩm sắp hết" /> : (
          <div className="table-wrap max-h-[560px] overflow-y-auto scroll-thin"><table className="tbl"><thead><tr><th>Sản phẩm</th><th className="num">Tồn</th><th className="num">Định mức</th></tr></thead>
            <tbody>{data.low.map((p: any) => <tr key={p.id}><td><div className="font-medium">{p.name}</div><div className="text-xs text-ink-400">{p.sku}</div></td><td className={cx('num font-semibold', p.quantity === 0 ? 'text-red-600' : 'text-amber-700')}>{p.quantity}</td><td className="num text-ink-400">{p.min_stock}</td></tr>)}</tbody></table></div>
        )}
      </div>
      <div className="card">
        <div className="px-5 py-4 border-b border-ivory-200 flex items-center gap-2"><Hourglass size={17} className="text-ink-500" /><h3 className="font-semibold">Tồn kho lâu &gt; {data.aging_days} ngày ({data.aging.length})</h3></div>
        {data.aging.length === 0 ? <Empty title="Không có hàng tồn lâu" /> : (
          <div className="table-wrap max-h-[560px] overflow-y-auto scroll-thin"><table className="tbl"><thead><tr><th>Đồng hồ / Serial</th><th>Kho</th><th className="num">Số ngày</th>{can('products.cost') && <th className="num">Giá vốn</th>}</tr></thead>
            <tbody>{data.aging.map((s: any) => <tr key={s.serial_id}><td><div className="font-medium">{s.name}</div><div className="text-xs text-ink-400 font-mono">{s.serial_number}{s.is_consignment ? ' · ký gửi' : ''}</div></td><td>{s.warehouse_name}</td><td className="num"><Badge tone={s.days_in_stock > 365 ? 'red' : 'amber'}>{s.days_in_stock}</Badge></td>{can('products.cost') && <td className="num">{money(s.cost_price)}</td>}</tr>)}</tbody></table></div>
        )}
        <p className="text-xs text-ink-400 px-5 py-3">Số ngày cảnh báo cấu hình tại Cài đặt → Kho hàng.</p>
      </div>
    </div>
  );
}

function ConsignTab() {
  const { can } = useAuth();
  const { confirm } = useUi();
  const { data, loading, reload } = useFetch(() => api.get('/inventory/consignments'), []);
  const { run } = useSubmit();
  if (loading || !data) return <Loading />;
  const settle = async (s: any) => {
    const m = await confirm({ title: `Thanh toán cho người ký gửi`, message: <>Chi <b>{money(s.consignment_price)}</b> cho {s.consignor_name} (serial {s.serial_number}). Phiếu chi sẽ được ghi vào sổ quỹ.</>, confirmText: 'Thanh toán tiền mặt' });
    if (m && (await run(() => api.post(`/inventory/consignments/${s.id}/settle`, { method: 'cash' }), 'Đã thanh toán cho người ký gửi'))) reload();
  };
  return (
    <div className="card">
      {data.length === 0 ? <Empty icon={<HandCoins size={22} />} title="Chưa có hàng ký gửi">Dùng "Phiếu khác → Nhận hàng ký gửi" để nhận đồng hồ khách gửi bán.</Empty> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Đồng hồ / Serial</th><th>Người ký gửi</th><th>Ngày nhận</th><th className="num">Giá ký gửi</th><th>Trạng thái</th><th className="num">Giá bán</th><th></th></tr></thead>
          <tbody>{data.map((s: any) => (
            <tr key={s.id}><td><div className="font-medium">{s.product_name}</div><div className="text-xs font-mono text-ink-400">{s.serial_number}</div></td><td>{s.consignor_name}<div className="text-xs text-ink-400">{s.consignor_phone}</div></td>
              <td>{date(s.received_at)}</td><td className="num">{money(s.consignment_price)}</td>
              <td>{s.status === 'sold' ? (s.consignment_settled_at ? <Badge tone="green">Đã bán · đã thanh toán</Badge> : <Badge tone="amber">Đã bán · chưa thanh toán</Badge>) : <Badge tone={s.status === 'in_stock' ? 'blue' : 'gray'}>{LABELS.serialStatus[s.status]}</Badge>}</td>
              <td className="num">{s.sold_price ? <>{money(s.sold_price)}<div className="text-xs text-ink-400">{s.order_code}</div></> : '—'}</td>
              <td>{s.status === 'sold' && !s.consignment_settled_at && can('finance.edit') && <button className="btn-gold btn-sm" onClick={() => settle(s)}>Thanh toán</button>}</td></tr>
          ))}</tbody></table></div>
      )}
    </div>
  );
}

function RepairTab() {
  const { data, loading } = useFetch(() => api.get('/serials', { status: 'repairing', pageSize: 200 }), []);
  if (loading || !data) return <Loading />;
  return (
    <div className="card">
      {data.rows.length === 0 ? <Empty icon={<Wrench size={22} />} title="Không có hàng tồn kho đang gửi sửa">Dùng "Phiếu khác → Gửi hàng đi sửa chữa" khi đưa đồng hồ trong kho đi bảo dưỡng/sửa.</Empty> : (
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Đồng hồ</th><th>Serial</th><th>Kho gốc</th><th>Ngày nhập</th><th>Ghi chú</th></tr></thead>
          <tbody>{data.rows.map((s: any) => <tr key={s.id}><td>{s.product_name}</td><td className="font-mono">{s.serial_number}</td><td>{s.warehouse_name}</td><td>{date(s.received_at)}</td><td className="text-xs">{s.note}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

// =================================================================== TẠO PHIẾU KHO
interface DocLine { product: any; quantity: number; unit_cost: number; serialsText: string; serial_ids: number[]; counted_qty?: number; available: any[] }

function StockDocForm({ type: initialType, onClose, onDone }: { type: string; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const warehouses = useWarehouses();
  const { data: suppliers } = useFetch(() => api.get('/suppliers'), []);
  const [type] = useState(initialType);
  const [h, setH] = useState<any>({ warehouse_id: '', to_warehouse_id: '', supplier_id: '', reason: '', note: '', paid_amount: 0, payment_method: 'transfer', consignor_name: '', consignor_phone: '' });
  const [lines, setLines] = useState<DocLine[]>([]);
  const { busy, run } = useSubmit();
  useEffect(() => { if (warehouses.length && !h.warehouse_id) setH((x: any) => ({ ...x, warehouse_id: (warehouses.find((w: any) => w.is_default) ?? warehouses[0]).id })); }, [warehouses]);

  const needsSerialPick = ['export', 'transfer', 'consign_return', 'repair_out', 'repair_in', 'stocktake'].includes(type);
  const isIn = type === 'import' || type === 'consign_in';
  const serialStatus = type === 'repair_in' ? 'repairing' : 'in_stock';

  const loadSerials = async (productId: number) => {
    const params: any = { product_id: productId, status: serialStatus, pageSize: 500 };
    if (type !== 'repair_in') params.warehouse_id = h.warehouse_id;
    if (type === 'consign_return') params.consignment = '1';
    return (await api.get('/serials', params)).rows;
  };
  // Đổi kho → tải lại danh sách serial
  useEffect(() => {
    if (!needsSerialPick || !h.warehouse_id) return;
    Promise.all(lines.map(async (l) => (l.product.track_serial ? { ...l, serial_ids: [], available: await loadSerials(l.product.id) } : l))).then(setLines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.warehouse_id]);

  const add = async (p: any) => {
    if (lines.some((l) => l.product.id === p.id)) return toast.error('Sản phẩm đã có trong phiếu');
    if (['adjust'].includes(type) && p.track_serial) return toast.error('Sản phẩm quản lý serial: dùng Nhập/Xuất/Kiểm kê thay vì điều chỉnh');
    if (['consign_return', 'repair_out', 'repair_in'].includes(type) && !p.track_serial) return toast.error('Chức năng này chỉ áp dụng cho đồng hồ quản lý serial');
    const available = needsSerialPick && p.track_serial ? await loadSerials(p.id) : [];
    setLines([...lines, { product: p, quantity: type === 'adjust' ? 1 : isIn ? 1 : 1, unit_cost: p.purchase_price ?? 0, serialsText: '', serial_ids: type === 'stocktake' ? available.map((s: any) => s.id) : [], counted_qty: type === 'stocktake' ? p.stock_qty : undefined, available }]);
  };
  const upd = (i: number, patch: Partial<DocLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const parseSerials = (t: string) => t.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const total = lines.reduce((s, l) => s + (isIn ? (l.product.track_serial ? parseSerials(l.serialsText).length : l.quantity) * l.unit_cost : 0), 0);

  const submit = async () => {
    if (!lines.length) return toast.error('Thêm ít nhất 1 sản phẩm');
    const body = {
      doc_type: type, ...h, to_warehouse_id: h.to_warehouse_id || null, supplier_id: h.supplier_id || null, paid_amount: type === 'import' ? h.paid_amount : 0,
      items: lines.map((l) => ({
        product_id: l.product.id, quantity: l.quantity, unit_cost: l.unit_cost,
        serials: isIn && l.product.track_serial ? parseSerials(l.serialsText).map((s) => ({ serial_number: s })) : [],
        serial_ids: l.serial_ids, counted_qty: l.counted_qty,
      })),
    };
    if (await run(() => api.post('/inventory/documents', body), `Đã tạo phiếu ${LABELS.docType[type].toLowerCase()}`)) onDone();
  };

  return (
    <Modal open size="xl" onClose={onClose} title={`Tạo phiếu: ${LABELS.docType[type]}`}
      footer={<><span className="mr-auto text-sm text-ink-500 self-center">{isIn && can('products.cost') ? <>Tổng giá trị: <b className="text-ink-900">{money(total)}</b></> : null}</span>
        <button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={submit}>Hoàn thành phiếu</button></>}>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label={type === 'transfer' ? 'Kho xuất' : 'Kho'} required><Select value={h.warehouse_id} onChange={(e) => setH({ ...h, warehouse_id: Number(e.target.value) })} options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))} /></Field>
          {type === 'transfer' && <Field label="Kho nhận" required><Select value={h.to_warehouse_id} onChange={(e) => setH({ ...h, to_warehouse_id: Number(e.target.value) })} placeholder="— Chọn —" options={warehouses.filter((w: any) => w.id !== h.warehouse_id).map((w: any) => ({ value: w.id, label: w.name }))} /></Field>}
          {type === 'import' && <Field label="Nhà cung cấp"><Select value={h.supplier_id} onChange={(e) => setH({ ...h, supplier_id: e.target.value })} placeholder="— Chọn —" options={(suppliers ?? []).map((s: any) => ({ value: s.id, label: s.name }))} /></Field>}
          {type === 'consign_in' && <>
            <Field label="Người/đơn vị ký gửi" required><input className="input" value={h.consignor_name} onChange={(e) => setH({ ...h, consignor_name: e.target.value })} /></Field>
            <Field label="SĐT người ký gửi"><input className="input" value={h.consignor_phone} onChange={(e) => setH({ ...h, consignor_phone: e.target.value })} /></Field>
          </>}
          <Field label={type === 'adjust' ? 'Lý do điều chỉnh' : 'Lý do'} required={type === 'adjust'}><input className="input" value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} /></Field>
          {type === 'import' && can('finance.edit', 'inventory.edit') && <>
            <Field label="Đã thanh toán NCC" hint="Phần còn lại ghi công nợ phải trả"><MoneyInput value={h.paid_amount} onChange={(v) => setH({ ...h, paid_amount: Math.min(v, total) })} /></Field>
            <Field label="Hình thức thanh toán"><Select value={h.payment_method} onChange={(e) => setH({ ...h, payment_method: e.target.value })} options={[{ value: 'transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }]} /></Field>
          </>}
        </div>
        <ProductPicker onPick={add} />
        {lines.length === 0 ? <Empty title="Chưa có sản phẩm trong phiếu">Tìm và chọn sản phẩm ở ô phía trên (hỗ trợ máy quét barcode).</Empty> : (
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={l.product.id} className="rounded-2xl border border-ivory-300 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div><div className="font-semibold">{l.product.name}</div><div className="text-xs text-ink-400">{l.product.sku} · tồn hiện tại {l.product.stock_qty} {l.product.track_serial ? '· quản lý serial' : ''}</div></div>
                  <button className="btn-ghost btn-icon w-8 h-8 hover:text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                </div>
                {isIn && (
                  <div className="grid sm:grid-cols-[1fr_200px] gap-3">
                    {l.product.track_serial
                      ? <Field label={`Serial Number – mỗi dòng 1 chiếc (${parseSerials(l.serialsText).length} chiếc)`}><Textarea rows={3} className="font-mono" value={l.serialsText} onChange={(e) => upd(i, { serialsText: e.target.value })} placeholder={'Quét hoặc nhập serial, Enter xuống dòng\nSN000001\nSN000002'} /></Field>
                      : <Field label="Số lượng"><input className="input" type="number" min={1} value={l.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value) })} /></Field>}
                    {can('products.cost') && <Field label={type === 'consign_in' ? 'Giá ký gửi (trả cho chủ hàng)' : 'Đơn giá nhập'}><MoneyInput value={l.unit_cost} onChange={(v) => upd(i, { unit_cost: v })} /></Field>}
                  </div>
                )}
                {needsSerialPick && l.product.track_serial && (
                  l.available.length === 0 ? <div className="text-sm text-red-600">Không có serial phù hợp ở kho này</div> : (
                    <div>
                      <div className="text-xs text-ink-500 mb-2">{type === 'stocktake' ? 'Bỏ chọn các serial KHÔNG tìm thấy khi kiểm kê (serial bị bỏ chọn sẽ được ghi giảm tồn):' : 'Chọn serial:'} <b>{l.serial_ids.length}/{l.available.length}</b></div>
                      <div className="flex flex-wrap gap-2">
                        {l.available.map((s: any) => {
                          const on = l.serial_ids.includes(s.id);
                          return <button key={s.id} type="button" onClick={() => upd(i, { serial_ids: on ? l.serial_ids.filter((x) => x !== s.id) : [...l.serial_ids, s.id] })}
                            className={cx('px-3 py-1.5 rounded-lg border text-xs font-mono transition', on ? 'bg-ink-900 text-gold-200 border-ink-900' : 'bg-white border-ivory-400 text-ink-600 hover:border-gold-400')}>{s.serial_number}{s.is_consignment ? ' (KG)' : ''}</button>;
                        })}
                      </div>
                    </div>
                  )
                )}
                {!l.product.track_serial && ['export', 'transfer'].includes(type) && <Field label="Số lượng"><input className="input w-40" type="number" min={1} value={l.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value) })} /></Field>}
                {!l.product.track_serial && type === 'adjust' && <Field label="Số lượng điều chỉnh (+ tăng / – giảm)"><input className="input w-40" type="number" value={l.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value) })} /></Field>}
                {!l.product.track_serial && type === 'stocktake' && <Field label="Số lượng thực tế đếm được" hint={`Chênh lệch: ${(l.counted_qty ?? 0) - l.product.stock_qty}`}><input className="input w-40" type="number" min={0} value={l.counted_qty ?? 0} onChange={(e) => upd(i, { counted_qty: Number(e.target.value) })} /></Field>}
              </div>
            ))}
          </div>
        )}
        <Field label="Ghi chú"><Textarea rows={2} value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
        {type === 'stocktake' && <p className="text-xs text-ink-400">Kiểm kê tạo bút toán điều chỉnh chênh lệch vào sổ kho. Đồng hồ thừa (không có trong hệ thống) cần lập phiếu Nhập hàng.</p>}
      </div>
    </Modal>
  );
}


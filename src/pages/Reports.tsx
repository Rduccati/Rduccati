import { useState } from 'react';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, LABELS, money, monthStart, pct, today } from '../lib/format';
import { getPdfMake } from '../lib/printer';
import { DateRange, Empty, InfoRow, Loading, PageHeader, Tabs, cx, useFetch, useUi } from '../components/ui';
import RevenueChart from '../components/RevenueChart';

type Tab = 'pnl' | 'revenue' | 'products' | 'brands' | 'inventory' | 'staff' | 'customers';

interface ColDef { key: string; label: string; money?: boolean; pct?: boolean; num?: boolean }
const COLS: Record<Exclude<Tab, 'pnl'>, ColDef[]> = {
  revenue: [{ key: 'label', label: 'Kỳ' }, { key: 'orders', label: 'Số đơn', num: true }, { key: 'sales', label: 'Doanh số', money: true }, { key: 'refunds', label: 'Trả hàng', money: true }, { key: 'net_revenue', label: 'Doanh thu thuần', money: true }, { key: 'cogs', label: 'Giá vốn', money: true }, { key: 'gross_profit', label: 'Lợi nhuận gộp', money: true }],
  products: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Sản phẩm' }, { key: 'brand_name', label: 'Thương hiệu' }, { key: 'qty', label: 'SL bán', num: true }, { key: 'revenue', label: 'Doanh thu', money: true }, { key: 'cost', label: 'Giá vốn', money: true }, { key: 'profit', label: 'Lợi nhuận gộp', money: true }, { key: 'margin', label: 'Biên LN', pct: true }],
  brands: [{ key: 'brand_name', label: 'Thương hiệu' }, { key: 'qty', label: 'SL bán', num: true }, { key: 'revenue', label: 'Doanh thu', money: true }, { key: 'cost', label: 'Giá vốn', money: true }, { key: 'profit', label: 'Lợi nhuận gộp', money: true }],
  inventory: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Sản phẩm' }, { key: 'brand_name', label: 'Thương hiệu' }, { key: 'qty', label: 'Tồn', num: true }, { key: 'consign_qty', label: 'Ký gửi', num: true }, { key: 'repairing_qty', label: 'Đang sửa', num: true }, { key: 'stock_value', label: 'Giá trị vốn', money: true }, { key: 'retail_value', label: 'Giá trị bán', money: true }],
  staff: [{ key: 'full_name', label: 'Nhân viên' }, { key: 'role_name', label: 'Vai trò' }, { key: 'orders', label: 'Số đơn', num: true }, { key: 'revenue', label: 'Doanh thu', money: true }, { key: 'profit_est', label: 'LN gộp tạm tính', money: true }, { key: 'cancelled', label: 'Đơn hủy', num: true }, { key: 'hours', label: 'Giờ làm', num: true }, { key: 'late_days', label: 'Ngày đi muộn', num: true }],
  customers: [{ key: 'code', label: 'Mã KH' }, { key: 'name', label: 'Khách hàng' }, { key: 'phone', label: 'SĐT' }, { key: 'group', label: 'Nhóm' }, { key: 'orders', label: 'Số đơn', num: true }, { key: 'revenue', label: 'Doanh thu', money: true }],
};
const ENDPOINT: Record<Exclude<Tab, 'pnl'>, string> = { revenue: '/reports/revenue', products: '/reports/products', brands: '/reports/brands', inventory: '/reports/inventory', staff: '/reports/staff', customers: '/reports/customers' };
const TITLES: Record<Tab, string> = { pnl: 'Báo cáo lãi lỗ', revenue: 'Doanh thu theo thời gian', products: 'Lợi nhuận theo sản phẩm', brands: 'Thương hiệu bán chạy', inventory: 'Tồn kho & giá trị tồn', staff: 'Hiệu quả nhân viên', customers: 'Khách hàng mua nhiều nhất' };

const fmt = (c: ColDef, v: any) => (v == null ? '—' : c.money ? money(v) : c.pct ? pct(v) : c.num ? Number(v).toLocaleString('vi-VN') : String(v));

export default function Reports() {
  const { can, settings } = useAuth();
  const { toast } = useUi();
  const [tab, setTab] = useState<Tab>('pnl');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [group, setGroup] = useState('day');
  const [sort, setSort] = useState('profit');
  const params: any = { from, to, group, sort };
  const { data, loading } = useFetch(() => (tab === 'pnl' ? api.get('/reports/pnl', params) : api.get(ENDPOINT[tab], params)), [tab, from, to, group, sort]);
  const showCost = can('products.cost');
  const rows: any[] = Array.isArray(data) ? data.map((r: any) => ({ ...r, hours: r.work_minutes != null ? Math.round(r.work_minutes / 6) / 10 : undefined, group: r.customer_group ? LABELS.group[r.customer_group] : undefined })) : [];
  const cols = tab === 'pnl' ? [] : COLS[tab].filter((c) => showCost || !['cogs', 'gross_profit', 'cost', 'profit', 'margin', 'stock_value', 'profit_est'].includes(c.key));

  const exportPdf = async () => {
    try {
      const pdfMake = await getPdfMake();
      const store = settings.store?.name ?? 'WATCH POS';
      const header = [{ text: store.toUpperCase(), bold: true, fontSize: 13 }, { text: TITLES[tab], fontSize: 16, bold: true, margin: [0, 4, 0, 0] }, { text: `Kỳ báo cáo: ${from} → ${to} · Xuất lúc ${dateTime(new Date().toISOString())}`, fontSize: 9, color: '#555', margin: [0, 2, 0, 10] }];
      let body: any;
      if (tab === 'pnl') {
        const d = data;
        const line = (l: string, v: number, bold = false) => [{ text: l, bold }, { text: money(v), alignment: 'right', bold }];
        body = { table: { widths: ['*', 150], body: [
          line('Doanh số bán hàng (sau giảm giá)', d.sales), line('Trừ: Hàng bán bị trả lại', -d.refunds), line('DOANH THU THUẦN', d.net_revenue, true), line('Giá vốn hàng bán', -d.cogs),
          line('LỢI NHUẬN GỘP', d.gross_profit, true), ...d.other_income.map((x: any) => line('Thu nhập khác: ' + x.label, x.amount)), ...d.expenses.map((x: any) => line('Chi phí: ' + x.label, -x.amount)),
          line('LỢI NHUẬN RÒNG', d.net_profit, true), line('Dòng tiền vào (tổng phiếu thu)', d.cash_in), line('Dòng tiền ra (tổng phiếu chi)', -d.cash_out), line('DÒNG TIỀN THUẦN', d.net_cash_flow, true),
        ] }, layout: 'lightHorizontalLines' };
      } else {
        body = { table: { headerRows: 1, widths: cols.map((c) => (c.key === 'name' ? '*' : 'auto')), body: [cols.map((c) => ({ text: c.label, bold: true, fillColor: '#eeeeee' })), ...rows.map((r) => cols.map((c) => ({ text: fmt(c, r[c.key]), alignment: c.money || c.num || c.pct ? 'right' : 'left' })))] }, layout: 'lightHorizontalLines', fontSize: 8 };
      }
      pdfMake.createPdf({ pageSize: 'A4', pageOrientation: cols.length > 6 ? 'landscape' : 'portrait', defaultStyle: { font: 'Roboto', fontSize: 9 }, content: [...header, body] }).download(`bao-cao-${tab}-${from}-${to}.pdf`);
    } catch (e) { toast.error(e); }
  };

  return (
    <div>
      <PageHeader title="Báo cáo" subtitle="Doanh thu, lợi nhuận, tồn kho, nhân viên, khách hàng"
        actions={<>
          <button className="btn-outline" disabled={!data} onClick={exportPdf}><FileDown size={16} /> Xuất PDF</button>
          {tab !== 'pnl' && <button className="btn-outline" onClick={() => api.download(ENDPOINT[tab], { ...params, format: 'xlsx' }).catch(toast.error)}><FileSpreadsheet size={16} /> Xuất Excel</button>}
        </>} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={(Object.keys(TITLES) as Tab[]).map((t) => ({ value: t, label: TITLES[t] }))} />
      <div className="flex flex-wrap gap-3 items-center mb-4">
        {tab !== 'inventory' && <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />}
        {tab === 'revenue' && <div className="flex bg-white border border-ivory-300 rounded-xl p-1">{['day', 'week', 'month', 'year'].map((g) => <button key={g} onClick={() => setGroup(g)} className={cx('px-3 h-7 text-xs rounded-lg font-medium', group === g ? 'bg-ink-900 text-ivory-50' : 'text-ink-500')}>{{ day: 'Ngày', week: 'Tuần', month: 'Tháng', year: 'Năm' }[g]}</button>)}</div>}
        {tab === 'products' && <div className="flex bg-white border border-ivory-300 rounded-xl p-1">{[['profit', 'Lợi nhuận'], ['revenue', 'Doanh thu'], ['qty', 'Số lượng']].map(([k, l]) => <button key={k} onClick={() => setSort(k)} className={cx('px-3 h-7 text-xs rounded-lg font-medium', sort === k ? 'bg-ink-900 text-ivory-50' : 'text-ink-500')}>{l}</button>)}</div>}
      </div>
      {loading && !data ? <Loading /> : !data ? null : tab === 'pnl' ? <Pnl d={data} showCost={showCost} /> : (
        <div className="card">
          {tab === 'revenue' && rows.length > 0 && <div className="p-4 border-b border-ivory-200"><RevenueChart data={rows} showProfit={showCost} /></div>}
          {rows.length === 0 ? <Empty title="Không có dữ liệu trong kỳ" /> : (
            <div className="table-wrap"><table className="tbl">
              <thead><tr>{cols.map((c) => <th key={c.key} className={c.money || c.num || c.pct ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={cx(c.money || c.num || c.pct ? 'num' : '', c.key === 'name' && 'font-medium', c.key === 'profit' && r.profit < 0 && 'text-red-600')}>{fmt(c, r[c.key])}</td>)}</tr>)}</tbody>
              {cols.some((c) => c.money) && <tfoot><tr className="font-semibold bg-ivory-100">{cols.map((c, i) => <td key={c.key} className={cx('px-4 py-3', (c.money || c.num) && 'num')}>{i === 0 ? 'Tổng cộng' : c.money || (c.num && !['hours', 'late_days'].includes(c.key)) ? fmt(c, rows.reduce((s, r) => s + Number(r[c.key] || 0), 0)) : ''}</td>)}</tr></tfoot>}
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}

function Pnl({ d, showCost }: { d: any; showCost: boolean }) {
  const Row = ({ label, value, strong, neg, note }: { label: string; value: number; strong?: boolean; neg?: boolean; note?: string }) => (
    <div className={cx('flex justify-between items-baseline py-2.5 px-5 border-b border-ivory-200', strong && 'bg-ivory-100 font-semibold')}>
      <span>{label}{note && <span className="block text-xs text-ink-400 font-normal">{note}</span>}</span>
      <span className={cx('tabular-nums', value < 0 && 'text-red-600')}>{neg && value > 0 ? '-' + money(value) : money(value)}</span>
    </div>
  );
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-ivory-200"><h3 className="font-semibold">Kết quả kinh doanh</h3><p className="text-xs text-ink-400">{d.orders} đơn hàng trong kỳ</p></div>
        <Row label="Doanh số (giá niêm yết)" value={d.gross_sales} />
        <Row label="Giảm giá, khuyến mãi" value={d.discounts} neg />
        <Row label="Hàng bán bị trả lại" value={d.refunds} neg />
        <Row label="DOANH THU THUẦN" value={d.net_revenue} strong />
        {showCost ? <>
          <Row label="Giá vốn hàng bán" value={d.cogs} neg note="Theo giá vốn thực tế từng serial / bình quân" />
          <Row label="LỢI NHUẬN GỘP" value={d.gross_profit} strong note={`Biên lợi nhuận gộp ${pct(d.gross_margin)}`} />
          {d.other_income.map((x: any) => <Row key={x.category} label={`+ ${x.label}`} value={x.amount} />)}
          {d.expenses.map((x: any) => <Row key={x.category} label={`– ${x.label}`} value={x.amount} neg />)}
          <Row label="LỢI NHUẬN RÒNG" value={d.net_profit} strong note="Lợi nhuận gộp + thu nhập khác – chi phí hoạt động" />
        </> : <div className="p-5 text-sm text-ink-400">Bạn không có quyền xem giá vốn / lợi nhuận.</div>}
      </div>
      <div className="space-y-5">
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-ivory-200"><h3 className="font-semibold">Dòng tiền</h3><p className="text-xs text-ink-400">Tiền thực thu / thực chi – khác với doanh thu (bán nợ, trả nhà cung cấp...)</p></div>
          <Row label="Tổng tiền vào (phiếu thu)" value={d.cash_in} />
          <Row label="Tổng tiền ra (phiếu chi)" value={d.cash_out} neg />
          <Row label="DÒNG TIỀN THUẦN" value={d.net_cash_flow} strong />
        </div>
        <div className="card p-5">
          <h3 className="font-semibold mb-2">Chi tiết dòng tiền theo hạng mục</h3>
          {d.cash_flow.length === 0 ? <div className="text-sm text-ink-400">Không có</div> : d.cash_flow.map((x: any, i: number) => <InfoRow key={i} label={`${x.tx_type === 'receipt' ? 'Thu' : 'Chi'} · ${x.label}`}>{x.tx_type === 'receipt' ? '+' : '-'}{money(x.amount)}</InfoRow>)}
          {showCost && d.repair_parts_cost > 0 && <p className="text-xs text-ink-400 mt-3">Tham khảo: giá vốn linh kiện trên phiếu sửa đã giao trong kỳ {money(d.repair_parts_cost)} (chi phí thực tế ghi nhận qua phiếu chi "Chi phí sửa chữa / linh kiện").</p>}
        </div>
      </div>
    </div>
  );
}

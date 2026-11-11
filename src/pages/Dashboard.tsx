import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, CalendarClock, Coins, Hourglass, Receipt, ShieldCheck, ShoppingBag, TrendingUp, Users, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, LABELS, money, monthStart, shortMoney, today } from '../lib/format';
import { Badge, DateRange, ErrorBox, Loading, PageHeader, StatCard, Tabs, useFetch } from '../components/ui';
import RevenueChart from '../components/RevenueChart';

const statusTone: Record<string, string> = { completed: 'green', cancelled: 'red', returned: 'amber', partial_returned: 'amber' };

export default function Dashboard() {
  const nav = useNavigate();
  const { can, user } = useAuth();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [group, setGroup] = useState<'day' | 'week' | 'month' | 'year'>('day');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const { data: d, loading, error, reload } = useFetch(() => api.get('/reports/dashboard', { from, to, group }), [from, to, group]);
  const showCost = can('products.cost');

  return (
    <div>
      <PageHeader title={`Xin chào, ${user?.full_name ?? ''}`} subtitle="Tổng quan hoạt động kinh doanh"
        actions={<DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />} />
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !d ? <Loading /> : d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            <StatCard tone="dark" label="Doanh thu hôm nay" value={money(d.today.revenue)} sub={`${d.today.orders} đơn hàng`} icon={<Coins size={16} />} />
            <StatCard label="Doanh thu tháng" value={money(d.month.revenue)} sub={`${d.month.orders} đơn · tháng ${today().slice(5, 7)}`} icon={<TrendingUp size={16} />} />
            <StatCard label="Đơn hàng trong kỳ" value={d.period.orders.toLocaleString('vi-VN')} sub={`Doanh thu thuần ${shortMoney(d.period.revenue)}`} icon={<Receipt size={16} />} onClick={() => nav('/orders')} />
            {showCost
              ? <StatCard label="Lợi nhuận gộp tạm tính" value={money(d.period.gross_profit)} sub={`Doanh thu – giá vốn · LN ròng ${shortMoney(d.period.net_profit)}`} icon={<TrendingUp size={16} />} onClick={() => nav('/reports')} />
              : <StatCard label="Khách hàng" value={d.customers} sub={`+${d.new_customers} trong tháng`} icon={<Users size={16} />} />}
            <StatCard label="Sản phẩm đang tồn" value={Number(d.stock_qty).toLocaleString('vi-VN')} sub={showCost ? `Giá trị vốn ${shortMoney(d.stock_value)}` : 'chiếc / đơn vị'} icon={<Boxes size={16} />} onClick={() => nav('/inventory')} />
            <StatCard label="Khách hàng" value={Number(d.customers).toLocaleString('vi-VN')} sub={`+${d.new_customers} khách mới trong tháng`} icon={<Users size={16} />} onClick={() => nav('/customers')} />
            <StatCard label="Phiếu sửa chữa đang xử lý" value={d.counts.open_repairs} sub={`${d.counts.repairing} chiếc hàng tồn đang gửi sửa`} icon={<Wrench size={16} />} onClick={() => nav('/warranty')} />
            <StatCard label="Nhắc bảo dưỡng 30 ngày tới" value={d.counts.due_reminders} sub={`${d.counts.expiring_warranties} bảo hành sắp hết hạn`} icon={<CalendarClock size={16} />} onClick={() => nav('/warranty')} />
          </div>

          {(d.counts.low_stock > 0 || d.counts.aging_count > 0) && (
            <div className="flex flex-wrap gap-2">
              {d.counts.low_stock > 0 && <button onClick={() => nav('/inventory?tab=alerts')} className="chip bg-amber-50 text-amber-800 border border-amber-200 py-1.5 px-3 text-xs"><AlertTriangle size={14} /> {d.counts.low_stock} sản phẩm sắp hết / hết hàng</button>}
              {d.counts.aging_count > 0 && <button onClick={() => nav('/inventory?tab=alerts')} className="chip bg-ivory-200 text-ink-700 border border-ivory-400 py-1.5 px-3 text-xs"><Hourglass size={14} /> {d.counts.aging_count} chiếc tồn kho lâu</button>}
            </div>
          )}

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
              <div>
                <h3 className="font-semibold text-ink-900">Doanh thu {showCost ? '& lợi nhuận gộp' : ''}</h3>
                <p className="text-xs text-ink-400">Doanh thu thuần = doanh số – trả hàng. Lợi nhuận gộp = doanh thu thuần – giá vốn hàng bán.</p>
              </div>
              <div className="flex gap-2">
                <div className="flex bg-ivory-100 rounded-xl p-1">
                  {(['day', 'week', 'month', 'year'] as const).map((g) => (
                    <button key={g} onClick={() => setGroup(g)} className={`px-3 h-7 text-xs rounded-lg font-medium ${group === g ? 'bg-white shadow-sm text-ink-900' : 'text-ink-400'}`}>
                      {{ day: 'Ngày', week: 'Tuần', month: 'Tháng', year: 'Năm' }[g]}
                    </button>
                  ))}
                </div>
                <button className="btn-outline btn-sm" onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>{view === 'chart' ? 'Xem bảng' : 'Xem biểu đồ'}</button>
              </div>
            </div>
            <div className="p-3 sm:p-5">
              {view === 'chart' ? <RevenueChart data={d.chart} showProfit={showCost} /> : (
                <div className="table-wrap max-h-[300px] overflow-y-auto scroll-thin">
                  <table className="tbl"><thead><tr><th>Kỳ</th><th className="num">Số đơn</th><th className="num">Doanh thu thuần</th>{showCost && <><th className="num">Giá vốn</th><th className="num">Lợi nhuận gộp</th></>}</tr></thead>
                    <tbody>{d.chart.map((r: any) => <tr key={r.period}><td>{r.label}</td><td className="num">{r.orders}</td><td className="num">{money(r.net_revenue)}</td>{showCost && <><td className="num">{money(r.cogs)}</td><td className="num">{money(r.gross_profit)}</td></>}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <div className="card">
              <div className="flex items-center justify-between px-5 py-4 border-b border-ivory-200">
                <h3 className="font-semibold text-ink-900">Sản phẩm bán chạy</h3>
                <button className="text-xs text-gold-600 hover:underline" onClick={() => nav('/reports')}>Xem báo cáo</button>
              </div>
              {d.top_products.length === 0 ? <div className="p-6 text-sm text-ink-400 text-center">Chưa có đơn hàng trong kỳ</div> : (
                <ul className="divide-y divide-ivory-200">
                  {d.top_products.map((p: any, i: number) => (
                    <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                      <span className={`w-6 h-6 rounded-lg text-xs font-semibold flex items-center justify-center ${i < 3 ? 'bg-ink-900 text-gold-300' : 'bg-ivory-200 text-ink-500'}`}>{i + 1}</span>
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{p.name}</div><div className="text-xs text-ink-400">{p.brand_name ?? '—'} · {p.sku}</div></div>
                      <div className="text-right"><div className="text-sm font-semibold tabular-nums">{money(p.revenue)}</div><div className="text-xs text-ink-400">{p.qty} chiếc{showCost && p.profit != null ? ` · LN ${shortMoney(p.profit)}` : ''}</div></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <div className="flex items-center justify-between px-5 py-4 border-b border-ivory-200">
                <h3 className="font-semibold text-ink-900">Tồn kho lâu nhất</h3>
                <button className="text-xs text-gold-600 hover:underline" onClick={() => nav('/inventory?tab=alerts')}>Xem cảnh báo</button>
              </div>
              {d.aging.length === 0 ? <div className="p-6 text-sm text-ink-400 text-center">Không có hàng tồn</div> : (
                <ul className="divide-y divide-ivory-200">
                  {d.aging.map((p: any) => (
                    <li key={p.serial_number} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{p.name}</div><div className="text-xs text-ink-400">Serial {p.serial_number}</div></div>
                      <Badge tone={p.days > 180 ? 'red' : p.days > 90 ? 'amber' : 'gray'}>{p.days} ngày</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between px-5 py-4 border-b border-ivory-200">
              <h3 className="font-semibold text-ink-900">Đơn hàng mới nhất</h3>
              <div className="flex gap-2">
                {can('pos.sell') && <button className="btn-gold btn-sm" onClick={() => nav('/pos')}><ShoppingBag size={14} /> Bán hàng <span className="kbd">F2</span></button>}
                <button className="btn-outline btn-sm" onClick={() => nav('/orders')}>Tất cả đơn</button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Mã đơn</th><th>Thời gian</th><th>Khách hàng</th><th>Nhân viên</th><th className="num">Tổng tiền</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {d.latest_orders.map((o: any) => (
                    <tr key={o.id} className="clickable" onClick={() => nav(`/orders?open=${o.id}`)}>
                      <td className="font-medium">{o.code}</td><td className="text-ink-500">{dateTime(o.created_at)}</td><td>{o.customer_name ?? <span className="text-ink-300">Khách lẻ</span>}</td>
                      <td className="text-ink-500">{o.created_by_name}</td><td className="num font-semibold">{money(o.total)}</td><td><Badge tone={statusTone[o.status]}>{LABELS.orderStatus[o.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-ink-400 flex items-center gap-1.5"><ShieldCheck size={13} /> Số liệu tính theo giờ Việt Nam. Doanh thu không bao gồm đơn đã hủy; lợi nhuận gộp chưa trừ chi phí vận hành.</p>
        </div>
      )}
    </div>
  );
}


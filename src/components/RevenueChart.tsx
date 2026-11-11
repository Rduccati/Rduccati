import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money, shortMoney } from '../lib/format';

/** Màu đã kiểm định bằng validator (CVD ΔE ≥ 20, tương phản ≥ 3:1) */
export const SERIES = { revenue: '#a8772a', profit: '#1f6fb2' };

export default function RevenueChart({ data, showProfit }: { data: any[]; showProfit: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="#ece6da" />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d3cab8' }} tick={{ fontSize: 11, fill: '#7d776c' }} minTickGap={12} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#7d776c' }} tickFormatter={(v) => shortMoney(v)} width={56} />
        <Tooltip
          cursor={{ fill: 'rgba(201,169,110,0.12)' }}
          content={({ active, payload, label }) => active && payload?.length ? (
            <div className="rounded-xl bg-ink-900 text-ivory-50 text-xs px-3 py-2 shadow-lg">
              <div className="font-semibold mb-1">{label}</div>
              {payload.map((p: any) => (
                <div key={p.dataKey} className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />{p.name}: <b className="tabular-nums">{money(p.value)}</b></div>
              ))}
              <div className="text-ink-300 mt-1">{payload[0].payload.orders} đơn hàng</div>
            </div>
          ) : null}
        />
        {showProfit && <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12, color: '#57534b' }} />}
        <Bar dataKey="net_revenue" name="Doanh thu thuần" fill={SERIES.revenue} radius={[4, 4, 0, 0]} maxBarSize={28} />
        {showProfit && <Bar dataKey="gross_profit" name="Lợi nhuận gộp" fill={SERIES.profit} radius={[4, 4, 0, 0]} maxBarSize={28} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

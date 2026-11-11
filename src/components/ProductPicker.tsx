import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { cx } from './ui';

/** Ô tìm sản phẩm dùng chung (phiếu kho, in tem...). Enter = chọn kết quả đầu / khớp barcode */
export default function ProductPicker({ onPick, placeholder = 'Tìm sản phẩm theo tên, SKU, barcode...', extraParams }: { onPick: (p: any) => void; placeholder?: string; extraParams?: Record<string, any> }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!q.trim()) { setRows([]); return; }
    const t = setTimeout(() => api.get('/products', { q, pageSize: 12, active: '1', ...extraParams }).then((r) => { setRows(r.rows); setHi(0); }).catch(() => {}), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const pick = (p: any) => { onPick(p); setQ(''); setRows([]); ref.current?.focus(); };
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
      <input ref={ref} className="input pl-9" placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(rows.length - 1, h + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          if (e.key === 'Enter') { e.preventDefault(); const exact = rows.find((r) => r.barcode === q.trim() || r.sku.toLowerCase() === q.trim().toLowerCase()); if (exact || rows[hi]) pick(exact ?? rows[hi]); }
        }} />
      {open && rows.length > 0 && (
        <div className="absolute z-40 left-0 right-0 top-11 bg-white rounded-xl shadow-xl border border-ivory-300 max-h-80 overflow-y-auto scroll-thin">
          {rows.map((p, i) => (
            <button key={p.id} type="button" className={cx('w-full text-left px-4 py-2.5 border-b border-ivory-200 last:border-0 flex justify-between gap-3', i === hi && 'bg-gold-50')}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              <div className="min-w-0"><div className="text-sm font-medium truncate">{p.name}</div><div className="text-xs text-ink-400">{p.sku} · {p.barcode} {p.track_serial ? '· Serial' : ''}</div></div>
              <div className="text-right text-xs shrink-0"><div className="font-semibold text-sm">{money(p.sale_price)}</div><div className="text-ink-400">Tồn {p.stock_qty}</div></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

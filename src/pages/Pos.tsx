import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CreditCard, Landmark, Minus, PauseCircle, Plus, Printer, ScanLine, Search, Tag, Trash2, UserPlus, Users, X, FileDown, CheckCircle2, Wallet, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LABELS, money } from '../lib/format';
import { printerService } from '../lib/printer';
import { receiptJob, type Paper } from '../lib/documents';
import { Badge, cx, Field, Modal, MoneyInput, Select, Spinner, Toggle, useFetch, useSubmit, useUi } from '../components/ui';
import CustomerForm from '../components/CustomerForm';

interface Serial { id: number; serial_number: string; condition: string; is_consignment: boolean; movement_number?: string }
interface PosProduct { id: number; sku: string; barcode: string; name: string; brand_name?: string; model?: string; sale_price: number; promo_price: number | null; track_serial: boolean; serials: Serial[]; available: number; images: string[]; warranty_months: number }
interface Line { key: string; product: PosProduct; serial?: Serial | null; qty: number; price: number; discount: number }
interface Cart { id: number; lines: Line[]; customer: any | null; discountType: 'amount' | 'percent'; discountValue: number; promo: { code: string; amount: number; name: string } | null; note: string; pay: { cash: number | null; transfer: number; card: number }; allowDebt: boolean }

const emptyCart = (id: number): Cart => ({ id, lines: [], customer: null, discountType: 'amount', discountValue: 0, promo: null, note: '', pay: { cash: null, transfer: 0, card: 0 }, allowDebt: false });
const CART_KEY = 'watchpos_pos_carts';
const priceOf = (p: PosProduct) => (p.promo_price && Number(p.promo_price) > 0 ? Number(p.promo_price) : Number(p.sale_price));

export default function Pos() {
  const { settings, user } = useAuth();
  const { toast, confirm } = useUi();
  const { data: warehouses } = useFetch(() => api.get('/warehouses'), []);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [carts, setCarts] = useState<Cart[]>(() => {
    try { const s = JSON.parse(localStorage.getItem(CART_KEY) || 'null'); if (Array.isArray(s) && s.length) return s; } catch { /* ignore */ }
    return [emptyCart(1)];
  });
  const [active, setActive] = useState(0);
  const cart = carts[Math.min(active, carts.length - 1)];
  const update = useCallback((fn: (c: Cart) => Cart) => setCarts((cs) => cs.map((c, i) => (i === Math.min(active, cs.length - 1) ? fn(c) : c))), [active]);
  useEffect(() => { try { localStorage.setItem(CART_KEY, JSON.stringify(carts)); } catch { /* ignore */ } }, [carts]);

  useEffect(() => {
    if (warehouses && !warehouseId) setWarehouseId((warehouses.find((w: any) => w.is_default) ?? warehouses[0])?.id ?? null);
  }, [warehouses, warehouseId]);

  // ------------------------------------------------------------ Tìm kiếm & quét mã
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PosProduct[]>([]);
  const [hi, setHi] = useState(0);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [serialPick, setSerialPick] = useState<PosProduct | null>(null);

  useEffect(() => {
    if (!warehouseId) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try { setResults(await api.get('/pos/search', { q, warehouse_id: warehouseId })); setHi(0); } catch (e) { toast.error(e); } finally { setSearching(false); }
    }, q ? 180 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, warehouseId]);

  const usedSerials = useMemo(() => new Set(carts.flatMap((c) => c.lines.map((l) => l.serial?.id).filter(Boolean))), [carts]);

  const addProduct = (p: PosProduct, serialId?: number | null) => {
    if (p.track_serial) {
      const free = p.serials.filter((s) => !usedSerials.has(s.id));
      let s = serialId ? p.serials.find((x) => x.id === serialId) : null;
      if (serialId && usedSerials.has(serialId)) return toast.error('Serial này đã có trong giỏ hàng');
      if (!s) {
        if (free.length === 0) return toast.error(`${p.name}: không còn serial trong kho này`);
        if (free.length > 1) { setSerialPick(p); return; }
        s = free[0];
      }
      update((c) => ({ ...c, lines: [...c.lines, { key: `${p.id}-${s!.id}`, product: p, serial: s, qty: 1, price: priceOf(p), discount: 0 }] }));
      toast.success(`Đã thêm ${p.name} – ${s.serial_number}`);
    } else {
      update((c) => {
        const ex = c.lines.find((l) => l.product.id === p.id && !l.serial);
        if (ex) {
          if (ex.qty + 1 > p.available) { toast.error(`Chỉ còn ${p.available} trong kho`); return c; }
          return { ...c, lines: c.lines.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l)) };
        }
        if (p.available < 1) { toast.error('Hết hàng'); return c; }
        return { ...c, lines: [...c.lines, { key: `${p.id}`, product: p, qty: 1, price: priceOf(p), discount: 0 }] };
      });
    }
    setQ('');
    setShowResults(false);
    searchRef.current?.focus();
  };

  const onSearchKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setShowResults(true); setHi((h) => Math.min(results.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Escape') { setQ(''); setShowResults(false); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const code = q.trim();
      if (!code) return;
      // Ưu tiên tra cứu chính xác (máy quét): serial / barcode / SKU
      try {
        const r = await api.get('/pos/lookup', { code, warehouse_id: warehouseId });
        addProduct(r.product, r.serial_id);
      } catch (err: any) {
        if (err.status === 404 && results[hi]) addProduct(results[hi]);
        else toast.error(err);
      }
    }
  };

  // ------------------------------------------------------------ Tính tiền (mirror logic phía server)
  const subtotal = cart.lines.reduce((s, l) => s + l.price * l.qty - l.discount, 0);
  const orderDiscount = cart.discountValue > 0 ? (cart.discountType === 'percent' ? Math.round((subtotal * Math.min(100, cart.discountValue)) / 100) : Math.min(cart.discountValue, subtotal)) : 0;
  const promoAmount = cart.promo ? Math.min(cart.promo.amount, subtotal - orderDiscount) : 0;
  const total = Math.max(0, subtotal - orderDiscount - promoAmount);
  const nonCash = cart.pay.transfer + cart.pay.card;
  const cashNeeded = Math.max(0, total - nonCash);
  const cash = cart.pay.cash ?? cashNeeded;
  const paid = nonCash + Math.min(cash, cashNeeded);
  const change = Math.max(0, cash - cashNeeded);
  const missing = Math.max(0, total - paid);

  // Kiểm tra lại mã KM khi tổng tiền thay đổi
  useEffect(() => {
    if (!cart.promo) return;
    const t = setTimeout(async () => {
      try {
        const r = await api.post('/promotions/check', { code: cart.promo!.code, subtotal: subtotal - orderDiscount });
        if (r.amount !== cart.promo!.amount) update((c) => ({ ...c, promo: { ...c.promo!, amount: r.amount } }));
      } catch (e) { toast.error(e); update((c) => ({ ...c, promo: null })); }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, orderDiscount]);

  // ------------------------------------------------------------ Khách hàng
  const [custQ, setCustQ] = useState('');
  const [custResults, setCustResults] = useState<any[]>([]);
  const [custOpen, setCustOpen] = useState(false);
  const [newCust, setNewCust] = useState(false);
  const custRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!custQ.trim()) { setCustResults([]); return; }
    const t = setTimeout(() => api.get('/customers', { q: custQ, pageSize: 8 }).then((r) => setCustResults(r.rows)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [custQ]);

  // ------------------------------------------------------------ Khuyến mãi
  const [promoCode, setPromoCode] = useState('');
  const applyPromo = async () => {
    if (!promoCode.trim()) return;
    try {
      const r = await api.post('/promotions/check', { code: promoCode.trim(), subtotal: subtotal - orderDiscount });
      update((c) => ({ ...c, promo: { code: r.code, amount: r.amount, name: r.name } }));
      setPromoCode('');
      toast.success(`Áp dụng ${r.code}: giảm ${money(r.amount)}`);
    } catch (e) { toast.error(e); }
  };

  // ------------------------------------------------------------ Ca bán hàng
  const { data: shift, reload: reloadShift } = useFetch(() => api.get('/shifts/current'), []);
  const [shiftModal, setShiftModal] = useState<'open' | 'close' | null>(null);

  // ------------------------------------------------------------ Thanh toán
  const { busy, run } = useSubmit();
  const [done, setDone] = useState<any | null>(null);
  const cashRef = useRef<HTMLInputElement>(null);

  const checkout = async () => {
    if (!cart.lines.length) return toast.error('Giỏ hàng trống');
    if (!warehouseId) return toast.error('Chọn kho bán hàng');
    if (missing > 0 && !cart.allowDebt) return toast.error(`Khách thanh toán chưa đủ, còn thiếu ${money(missing)}. Bật "Cho phép ghi nợ" nếu bán nợ.`);
    if (missing > 0 && !cart.customer) return toast.error('Bán nợ cần chọn khách hàng');
    const payments = [
      ...(cash > 0 ? [{ method: 'cash', amount: cash }] : []),
      ...(cart.pay.transfer > 0 ? [{ method: 'transfer', amount: cart.pay.transfer }] : []),
      ...(cart.pay.card > 0 ? [{ method: 'card', amount: cart.pay.card }] : []),
    ];
    const order = await run(() => api.post('/orders', {
      customer_id: cart.customer?.id ?? null, warehouse_id: warehouseId,
      items: cart.lines.map((l) => ({ product_id: l.product.id, serial_id: l.serial?.id ?? null, quantity: l.qty, unit_price: l.price, discount: l.discount })),
      discount_type: cart.discountValue > 0 ? cart.discountType : null, discount_value: cart.discountValue, promotion_code: cart.promo?.code ?? null,
      payments, customer_given: cash, allow_debt: cart.allowDebt, note: cart.note || null,
    }));
    if (!order) return;
    if (order.total !== total) toast.info(`Lưu ý: tổng tiền được máy chủ tính lại là ${money(order.total)}`);
    const detail = await api.get(`/orders/${order.id}`);
    setDone(detail);
    update((c) => emptyCart(c.id));
    setQ('');
    api.get('/pos/search', { q: '', warehouse_id: warehouseId }).then(setResults).catch(() => {});
    reloadShift();
    if (settings.printer?.auto_print_after_sale) printReceipt(detail);
  };

  const printReceipt = async (o: any, paper?: Paper) => {
    try {
      await printerService.print(receiptJob(o, settings, paper), settings.printer?.driver);
      await api.post(`/orders/${o.id}/printed`);
    } catch (e) { toast.error(e); }
  };

  // ------------------------------------------------------------ Phím tắt
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (done) {
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'F9') { e.preventDefault(); setDone(null); setTimeout(() => searchRef.current?.focus(), 50); }
        if (e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); printReceipt(done); }
        return;
      }
      if (e.key === 'F3') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); custRef.current?.focus(); }
      else if (e.key === 'F8') { e.preventDefault(); cashRef.current?.focus(); }
      else if (e.key === 'F9') { e.preventDefault(); checkout(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const addCart = () => {
    if (carts.length >= 6) return toast.error('Tối đa 6 đơn chờ');
    const id = Math.max(...carts.map((c) => c.id)) + 1;
    setCarts([...carts, emptyCart(id)]);
    setActive(carts.length);
  };
  const closeCart = async (idx: number) => {
    if (carts[idx].lines.length && !(await confirm({ title: 'Đóng đơn đang chờ?', message: 'Các sản phẩm trong đơn này sẽ bị xóa khỏi giỏ.', danger: true }))) return;
    if (carts.length === 1) { setCarts([emptyCart(1)]); setActive(0); return; }
    setCarts(carts.filter((_, i) => i !== idx));
    setActive(Math.max(0, idx - 1));
  };

  const quickCash = useMemo(() => {
    const base = cashNeeded;
    const set = new Set<number>([base]);
    for (const step of [50000, 100000, 500000, 1000000]) set.add(Math.ceil(base / step) * step);
    return [...set].filter((v) => v > 0).sort((a, b) => a - b).slice(0, 5);
  }, [cashNeeded]);

  return (
    <div className="h-full flex flex-col lg:flex-row bg-ivory-100">
      {/* ============================================================ CỘT TRÁI: tìm kiếm + giỏ hàng */}
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="bg-ink-900 px-3 sm:px-4 pt-3 pb-0">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <ScanLine size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gold-400" />
              <input ref={searchRef} autoFocus value={q} onChange={(e) => { setQ(e.target.value); setShowResults(true); }} onKeyDown={onSearchKey}
                onFocus={() => setShowResults(true)} onBlur={() => setTimeout(() => setShowResults(false), 180)}
                placeholder="Quét mã vạch / nhập tên, SKU, Serial... (F3)" className="w-full h-11 rounded-xl bg-ink-800 border border-ink-600 pl-11 pr-20 text-ivory-50 placeholder:text-ink-400 focus:outline-none focus:border-gold-400" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2">{searching ? <Spinner size={16} /> : <span className="kbd bg-ink-700 border-ink-600 text-ink-300">Enter</span>}</span>
              {showResults && results.length > 0 && (
                <div className="absolute z-30 left-0 right-0 top-12 bg-white rounded-xl shadow-2xl border border-ivory-300 max-h-[60vh] overflow-y-auto scroll-thin">
                  {results.map((p, i) => (
                    <button key={p.id} onMouseDown={(e) => { e.preventDefault(); addProduct(p); }} onMouseEnter={() => setHi(i)}
                      className={cx('w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-ivory-200 last:border-0', i === hi && 'bg-gold-50')}>
                      <div className="w-10 h-10 rounded-lg bg-ivory-200 overflow-hidden shrink-0 flex items-center justify-center">
                        {p.images?.[0] ? <img src={p.images[0]} className="w-full h-full object-cover" /> : <span className="text-[10px] font-semibold text-ink-400">{(p.brand_name ?? 'WP').slice(0, 3).toUpperCase()}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink-900 truncate">{p.name}</div>
                        <div className="text-xs text-ink-400 truncate">{p.sku} · {p.barcode}{p.track_serial ? ` · ${p.serials.length} serial` : ''}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold tabular-nums">{money(priceOf(p))}</div>
                        {p.promo_price ? <div className="text-[11px] text-ink-300 line-through">{money(p.sale_price)}</div> : <div className="text-[11px] text-ink-400">Tồn {p.available}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Select className="!h-11 !w-auto max-w-[170px] !bg-ink-800 !border-ink-600 !text-ivory-100 hidden sm:block" value={warehouseId ?? ''} onChange={(e) => setWarehouseId(Number(e.target.value))}
              options={(warehouses ?? []).filter((w: any) => w.is_active).map((w: any) => ({ value: w.id, label: w.name }))} />
          </div>
          <div className="flex items-end gap-1 mt-3 overflow-x-auto">
            {carts.map((c, i) => (
              <div key={c.id} className={cx('group flex items-center gap-1 pl-3.5 pr-1.5 h-9 rounded-t-xl text-sm cursor-pointer shrink-0', i === active ? 'bg-ivory-100 text-ink-900 font-medium' : 'bg-ink-800 text-ink-300 hover:text-ivory-100')} onClick={() => setActive(i)}>
                Đơn {c.id}{c.lines.length > 0 && <span className="ml-1 text-[10px] rounded-full bg-gold-400 text-ink-900 px-1.5">{c.lines.length}</span>}
                <button className="p-1 rounded hover:bg-ink-600/20 opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); closeCart(i); }}><X size={12} /></button>
              </div>
            ))}
            <button className="h-8 px-3 mb-0.5 rounded-lg text-ink-300 hover:text-gold-300 text-sm flex items-center gap-1" onClick={addCart} title="Thêm đơn chờ"><Plus size={14} /> <PauseCircle size={14} /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-3 sm:p-4">
          {cart.lines.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-ink-400 py-10">
              <div className="w-16 h-16 rounded-2xl bg-white border border-ivory-300 flex items-center justify-center mb-4"><ScanLine size={28} className="text-gold-500" /></div>
              <div className="font-medium text-ink-600">Quét mã vạch hoặc tìm sản phẩm để bắt đầu</div>
              <div className="text-xs mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                <span><span className="kbd">F3</span> Tìm SP</span><span><span className="kbd">F4</span> Khách hàng</span><span><span className="kbd">F8</span> Tiền khách đưa</span><span><span className="kbd">F9</span> Thanh toán</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.lines.map((l, idx) => (
                <div key={l.key} className="card px-3 sm:px-4 py-3 flex flex-wrap sm:flex-nowrap items-center gap-3">
                  <span className="w-6 text-xs text-ink-300 tabular-nums">{idx + 1}</span>
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="text-sm font-semibold text-ink-900 truncate">{l.product.name}</div>
                    <div className="text-xs text-ink-400 flex flex-wrap gap-x-2">
                      <span>{l.product.sku}</span>
                      {l.serial && <span className="text-gold-700 font-medium">Serial: {l.serial.serial_number}</span>}
                      {l.serial?.is_consignment && <Badge tone="violet">Ký gửi</Badge>}
                      {l.serial && l.serial.condition !== 'new' && <Badge tone="amber">{LABELS.condition[l.serial.condition]}</Badge>}
                      {l.product.warranty_months > 0 && l.serial && <span>BH {l.product.warranty_months} tháng</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {l.serial ? <span className="w-[92px] text-center text-sm text-ink-500">x1</span> : (
                      <>
                        <button className="btn-outline btn-icon w-8 h-8" onClick={() => update((c) => ({ ...c, lines: c.lines.map((x) => (x === l ? { ...x, qty: Math.max(1, x.qty - 1) } : x)) }))}><Minus size={14} /></button>
                        <input className="input h-8 w-11 px-1 text-center" value={l.qty} inputMode="numeric"
                          onChange={(e) => { const v = Math.max(1, Math.min(l.product.available, Number(e.target.value.replace(/\D/g, '')) || 1)); update((c) => ({ ...c, lines: c.lines.map((x) => (x === l ? { ...x, qty: v } : x)) })); }} />
                        <button className="btn-outline btn-icon w-8 h-8" onClick={() => { if (l.qty >= l.product.available) return toast.error(`Chỉ còn ${l.product.available}`); update((c) => ({ ...c, lines: c.lines.map((x) => (x === l ? { ...x, qty: x.qty + 1 } : x)) })); }}><Plus size={14} /></button>
                      </>
                    )}
                  </div>
                  <div className="w-[130px]">
                    <div className="text-[10px] text-ink-400 mb-0.5">Đơn giá</div>
                    <MoneyInput className="h-8 text-sm" value={l.price} onChange={(v) => update((c) => ({ ...c, lines: c.lines.map((x) => (x === l ? { ...x, price: v } : x)) }))} />
                  </div>
                  <div className="w-[110px]">
                    <div className="text-[10px] text-ink-400 mb-0.5">Giảm giá</div>
                    <MoneyInput className="h-8 text-sm" value={l.discount} placeholder="0" onChange={(v) => update((c) => ({ ...c, lines: c.lines.map((x) => (x === l ? { ...x, discount: Math.min(v, x.price * x.qty) } : x)) }))} />
                  </div>
                  <div className="w-[120px] text-right">
                    <div className="text-[10px] text-ink-400 mb-0.5">Thành tiền</div>
                    <div className="font-semibold tabular-nums">{money(l.price * l.qty - l.discount)}</div>
                  </div>
                  <button className="btn-ghost btn-icon text-ink-300 hover:text-red-600" onClick={() => update((c) => ({ ...c, lines: c.lines.filter((x) => x !== l) }))} title="Xóa"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="hidden lg:flex items-center justify-between px-4 py-2 border-t border-ivory-300 bg-white text-xs text-ink-400">
          <div className="flex gap-3"><span><span className="kbd">F2</span> POS</span><span><span className="kbd">F3</span> Tìm SP</span><span><span className="kbd">F4</span> Khách</span><span><span className="kbd">F8</span> Tiền mặt</span><span><span className="kbd">F9</span> Thanh toán</span><span><span className="kbd">↑↓</span> Chọn</span></div>
          <button className="flex items-center gap-1.5 hover:text-ink-700" onClick={() => setShiftModal(shift ? 'close' : 'open')}>
            <Wallet size={14} /> {shift ? <>Ca {shift.code} · {shift.order_count} đơn · Tiền mặt {money(shift.expected_cash_now)}</> : 'Chưa mở ca – bấm để mở ca'}
          </button>
        </div>
      </section>

      {/* ============================================================ CỘT PHẢI: khách hàng + thanh toán */}
      <aside className="w-full lg:w-[400px] xl:w-[430px] shrink-0 bg-white border-l border-ivory-300 flex flex-col min-h-0 max-h-[60vh] lg:max-h-none">
        <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-4">
          {/* Khách hàng */}
          <div>
            {cart.customer ? (
              <div className="flex items-center gap-3 rounded-xl border border-gold-200 bg-gold-50 px-3 py-2.5">
                <div className="w-9 h-9 rounded-full bg-ink-900 text-gold-300 flex items-center justify-center text-sm font-semibold">{cart.customer.name[0]}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate flex items-center gap-1.5">{cart.customer.name} {cart.customer.customer_group !== 'normal' && <Badge tone="dark">{LABELS.group[cart.customer.customer_group]}</Badge>}</div>
                  <div className="text-xs text-ink-500">{cart.customer.phone ?? '—'}{Number(cart.customer.debt) > 0 && <span className="text-red-600"> · Nợ {money(cart.customer.debt)}</span>}</div>
                </div>
                <button className="btn-ghost btn-icon w-8 h-8" onClick={() => update((c) => ({ ...c, customer: null }))}><X size={15} /></button>
              </div>
            ) : (
              <div className="relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
                    <input ref={custRef} className="input pl-9" placeholder="Khách hàng: SĐT hoặc tên (F4)" value={custQ}
                      onChange={(e) => { setCustQ(e.target.value); setCustOpen(true); }} onFocus={() => setCustOpen(true)} onBlur={() => setTimeout(() => setCustOpen(false), 180)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && custResults[0]) { update((c) => ({ ...c, customer: custResults[0] })); setCustQ(''); } }} />
                  </div>
                  <button className="btn-outline btn-icon w-10 h-10" title="Thêm khách hàng mới" onClick={() => setNewCust(true)}><UserPlus size={16} /></button>
                </div>
                {custOpen && custQ && (
                  <div className="absolute z-30 left-0 right-0 top-11 bg-white rounded-xl shadow-xl border border-ivory-300 max-h-72 overflow-y-auto">
                    {custResults.length === 0 ? (
                      <button className="w-full text-left px-4 py-3 text-sm text-gold-700" onMouseDown={(e) => { e.preventDefault(); setNewCust(true); }}>+ Tạo khách hàng mới "{custQ}"</button>
                    ) : custResults.map((c) => (
                      <button key={c.id} className="w-full text-left px-4 py-2.5 hover:bg-gold-50 border-b border-ivory-200 last:border-0" onMouseDown={(e) => { e.preventDefault(); update((x) => ({ ...x, customer: c })); setCustQ(''); }}>
                        <div className="text-sm font-medium">{c.name} {c.customer_group !== 'normal' && <Badge tone="dark">{LABELS.group[c.customer_group]}</Badge>}</div>
                        <div className="text-xs text-ink-400">{c.phone} · {c.order_count} đơn · {money(c.total_spent)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tổng tiền */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-ink-500">Tổng tiền hàng ({cart.lines.reduce((s, l) => s + l.qty, 0)} SP)</span><span className="tabular-nums font-medium">{money(subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-500 shrink-0">Giảm giá đơn</span>
              <div className="flex items-center gap-1.5">
                <div className="flex bg-ivory-100 rounded-lg p-0.5 text-xs">
                  {(['amount', 'percent'] as const).map((t) => (
                    <button key={t} className={cx('px-2 h-7 rounded-md font-medium', cart.discountType === t ? 'bg-white shadow-sm' : 'text-ink-400')} onClick={() => update((c) => ({ ...c, discountType: t, discountValue: 0 }))}>{t === 'amount' ? 'đ' : '%'}</button>
                  ))}
                </div>
                {cart.discountType === 'amount'
                  ? <div className="w-32"><MoneyInput className="h-8" value={cart.discountValue} placeholder="0" onChange={(v) => update((c) => ({ ...c, discountValue: v }))} /></div>
                  : <input className="input h-8 w-20 text-right" inputMode="decimal" value={cart.discountValue || ''} placeholder="0" onChange={(e) => update((c) => ({ ...c, discountValue: Math.min(100, Number(e.target.value.replace(/[^\d.]/g, '')) || 0) }))} />}
              </div>
            </div>
            {orderDiscount > 0 && <div className="flex justify-end text-xs text-ink-400">-{money(orderDiscount)}</div>}
            {cart.promo ? (
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 text-emerald-800 px-3 py-1.5">
                <span className="flex items-center gap-1.5 text-xs"><Tag size={13} /> {cart.promo.code} – {cart.promo.name}</span>
                <span className="flex items-center gap-1 tabular-nums">-{money(promoAmount)} <button onClick={() => update((c) => ({ ...c, promo: null }))}><X size={13} /></button></span>
              </div>
            ) : (
              <div className="flex gap-2">
                <input className="input h-8 text-xs uppercase" placeholder="Mã khuyến mãi" value={promoCode} onChange={(e) => setPromoCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyPromo()} />
                <button className="btn-outline btn-sm" onClick={applyPromo} disabled={!promoCode.trim() || !cart.lines.length}>Áp dụng</button>
              </div>
            )}
            <div className="flex justify-between items-end pt-3 border-t border-ivory-300">
              <span className="font-semibold text-ink-700">KHÁCH CẦN TRẢ</span>
              <span className="text-[28px] leading-none font-semibold tabular-nums text-ink-900">{money(total)}</span>
            </div>
          </div>

          {/* Thanh toán */}
          <div className="rounded-2xl bg-ivory-100 p-3 space-y-2.5">
            <div className="grid grid-cols-[132px_1fr] items-center gap-2 [&>span]:whitespace-nowrap">
              <span className="flex items-center gap-1.5 text-sm text-ink-600"><Banknote size={15} /> Tiền mặt <span className="kbd">F8</span></span>
              <MoneyInput ref={cashRef} value={cart.pay.cash ?? cashNeeded} onChange={(v) => update((c) => ({ ...c, pay: { ...c.pay, cash: v } }))} />
              <span className="flex items-center gap-1.5 text-sm text-ink-600"><Landmark size={15} /> Chuyển khoản</span>
              <div className="flex gap-1.5">
                <div className="flex-1"><MoneyInput value={cart.pay.transfer} placeholder="0" onChange={(v) => update((c) => ({ ...c, pay: { ...c.pay, transfer: Math.min(v, total - c.pay.card), cash: null } }))} /></div>
                <button className="btn-outline btn-sm h-10" title="Chuyển khoản toàn bộ" onClick={() => update((c) => ({ ...c, pay: { cash: 0, card: 0, transfer: total } }))}>Tất cả</button>
              </div>
              <span className="flex items-center gap-1.5 text-sm text-ink-600"><CreditCard size={15} /> Thẻ</span>
              <MoneyInput value={cart.pay.card} placeholder="0" onChange={(v) => update((c) => ({ ...c, pay: { ...c.pay, card: Math.min(v, total - c.pay.transfer), cash: null } }))} />
            </div>
            {cashNeeded > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {quickCash.map((v) => <button key={v} className="btn-outline btn-sm" onClick={() => update((c) => ({ ...c, pay: { ...c.pay, cash: v } }))}>{money(v, false)}</button>)}
              </div>
            )}
            <div className="flex justify-between text-sm pt-1">
              {missing > 0 ? <><span className="text-red-600 font-medium">Còn thiếu</span><span className="text-red-600 font-semibold tabular-nums">{money(missing)}</span></>
                : <><span className="text-ink-500">Tiền thừa trả khách</span><span className="font-semibold tabular-nums text-emerald-700">{money(change)}</span></>}
            </div>
            {missing > 0 && <Toggle checked={cart.allowDebt} onChange={(v) => update((c) => ({ ...c, allowDebt: v }))} label={<span className="text-xs">Cho phép ghi nợ phần còn thiếu</span>} />}
          </div>
          <textarea className="input text-sm" rows={2} placeholder="Ghi chú đơn hàng..." value={cart.note} onChange={(e) => update((c) => ({ ...c, note: e.target.value }))} />
        </div>
        <div className="p-4 border-t border-ivory-300 bg-white">
          <button className="btn-gold w-full h-14 text-base font-semibold rounded-2xl" disabled={busy || !cart.lines.length} onClick={checkout}>
            {busy ? <Spinner className="text-ink-900" /> : <>THANH TOÁN {money(total)} <span className="kbd bg-gold-200 border-gold-500">F9</span></>}
          </button>
          <div className="text-[11px] text-ink-400 text-center mt-2">Thu ngân: {user?.full_name}</div>
        </div>
      </aside>

      {/* ============================================================ Modals */}
      {serialPick && (
        <Modal open title="Chọn Serial Number" subtitle={serialPick.name} onClose={() => setSerialPick(null)} size="sm">
          <div className="space-y-2">
            {serialPick.serials.filter((s) => !usedSerials.has(s.id)).map((s, i) => (
              <button key={s.id} autoFocus={i === 0} className="w-full flex items-center justify-between rounded-xl border border-ivory-300 px-4 py-3 hover:border-gold-400 hover:bg-gold-50 focus:border-gold-400 focus:bg-gold-50 text-left"
                onClick={() => { const p = serialPick; setSerialPick(null); addProduct(p, s.id); }}>
                <div><div className="font-semibold text-sm">{s.serial_number}</div>{s.movement_number && <div className="text-xs text-ink-400">Movement: {s.movement_number}</div>}</div>
                <div className="flex gap-1">{s.is_consignment && <Badge tone="violet">Ký gửi</Badge>}<Badge tone={s.condition === 'new' ? 'green' : 'amber'}>{LABELS.condition[s.condition]}</Badge></div>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {newCust && (
        <Modal open title="Thêm khách hàng mới" onClose={() => setNewCust(false)}>
          <CustomerForm initial={{ phone: /^\d+$/.test(custQ) ? custQ : '', name: /^\d+$/.test(custQ) ? '' : custQ }} onSaved={(c) => { update((x) => ({ ...x, customer: { ...c, debt: 0 } })); setNewCust(false); setCustQ(''); }} onCancel={() => setNewCust(false)} />
        </Modal>
      )}
      {done && (
        <Modal open title="Thanh toán thành công" onClose={() => setDone(null)} size="sm"
          footer={<button className="btn-primary" autoFocus onClick={() => { setDone(null); setTimeout(() => searchRef.current?.focus(), 50); }}>Đơn mới (Enter)</button>}>
          <div className="text-center">
            <CheckCircle2 className="mx-auto text-emerald-600" size={44} />
            <div className="mt-2 text-sm text-ink-500">Đơn hàng <b className="text-ink-900">{done.code}</b></div>
            <div className="text-3xl font-semibold tabular-nums mt-1">{money(done.total)}</div>
            {Number(done.change_amount) > 0 && <div className="mt-2 text-emerald-700 font-medium">Tiền thừa trả khách: {money(done.change_amount)}</div>}
            {done.warranties?.length > 0 && <div className="mt-2 text-xs text-ink-400">Đã tạo {done.warranties.length} phiếu bảo hành điện tử</div>}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-5">
            <button className="btn-gold" onClick={() => printReceipt(done, 'K80')}><Printer size={16} /> In K80 <span className="kbd">Ctrl+P</span></button>
            <button className="btn-outline" onClick={() => printReceipt(done, 'K58')}><Printer size={16} /> In K58</button>
            <button className="btn-outline col-span-2" onClick={() => printerService.downloadPdf(receiptJob(done, settings)).catch(toast.error)}><FileDown size={16} /> Tải hóa đơn PDF</button>
          </div>
        </Modal>
      )}
      {shiftModal && <ShiftModal mode={shiftModal} shift={shift} onClose={() => setShiftModal(null)} onDone={() => { setShiftModal(null); reloadShift(); }} />}
      {/* Nút ca cho mobile */}
      <button className="lg:hidden fixed bottom-24 right-4 z-20 btn-primary rounded-full shadow-xl" onClick={() => setShiftModal(shift ? 'close' : 'open')}><Wallet size={16} /> {shift ? 'Đóng ca' : 'Mở ca'}</button>
    </div>
  );
}

function ShiftModal({ mode, shift, onClose, onDone }: { mode: 'open' | 'close'; shift: any; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const { busy, run } = useSubmit();
  const [result, setResult] = useState<any>(null);
  if (result) return (
    <Modal open title={`Đã đóng ca ${result.code}`} onClose={onDone} size="sm" footer={<button className="btn-primary" onClick={onDone}>Xong</button>}>
      <div className="text-sm space-y-1.5">
        <div className="flex justify-between"><span>Tiền mặt dự kiến</span><b>{money(result.expected_cash)}</b></div>
        <div className="flex justify-between"><span>Tiền mặt thực đếm</span><b>{money(result.counted_cash)}</b></div>
        <div className={cx('flex justify-between font-semibold', result.difference === 0 ? 'text-emerald-700' : 'text-red-600')}><span>Chênh lệch</span><span>{money(result.difference)}</span></div>
      </div>
    </Modal>
  );
  return (
    <Modal open title={mode === 'open' ? 'Mở ca bán hàng' : `Đóng ca ${shift?.code}`} onClose={onClose} size="sm"
      footer={<>
        <button className="btn-outline" onClick={onClose}>Hủy</button>
        <button className="btn-primary" disabled={busy} onClick={async () => {
          if (mode === 'open') { const r = await run(() => api.post('/shifts/open', { opening_cash: amount, note }), 'Đã mở ca bán hàng'); if (r) onDone(); }
          else { const r = await run(() => api.post(`/shifts/${shift.id}/close`, { counted_cash: amount, note })); if (r) setResult(r); }
        }}>{mode === 'open' ? 'Mở ca' : <><Lock size={15} /> Đóng ca & đối soát</>}</button>
      </>}>
      {mode === 'close' && shift && (
        <div className="rounded-xl bg-ivory-100 p-3 text-sm space-y-1.5 mb-4">
          <div className="flex justify-between"><span className="text-ink-500">Bắt đầu</span><span>{new Date(shift.opened_at).toLocaleString('vi-VN')}</span></div>
          <div className="flex justify-between"><span className="text-ink-500">Số đơn / Doanh thu</span><span>{shift.order_count} / {money(shift.revenue)}</span></div>
          <div className="flex justify-between"><span className="text-ink-500">Tiền đầu ca</span><span>{money(shift.opening_cash)}</span></div>
          <div className="flex justify-between"><span className="text-ink-500">Thu tiền mặt</span><span>+{money(shift.cash_in)}</span></div>
          <div className="flex justify-between"><span className="text-ink-500">Chi tiền mặt</span><span>-{money(shift.cash_out)}</span></div>
          <div className="flex justify-between"><span className="text-ink-500">Chuyển khoản / Thẻ</span><span>{money(shift.transfer_in)} / {money(shift.card_in)}</span></div>
          <div className="flex justify-between font-semibold pt-1.5 border-t border-ivory-300"><span>Tiền mặt dự kiến trong két</span><span>{money(shift.expected_cash_now)}</span></div>
        </div>
      )}
      <div className="space-y-3">
        <Field label={mode === 'open' ? 'Tiền mặt đầu ca (tiền lẻ trong két)' : 'Tiền mặt thực đếm cuối ca'}><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
        <Field label="Ghi chú"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

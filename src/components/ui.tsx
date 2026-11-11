import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, Search, X, XCircle } from 'lucide-react';
import { addDays, monthStart, today } from '../lib/format';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// =================================================================== Toast & Confirm
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }
interface ConfirmOpts { title: string; message?: ReactNode; confirmText?: string; danger?: boolean; input?: { label: string; placeholder?: string; required?: boolean } }
interface UiCtx {
  toast: { success: (t: string) => void; error: (t: unknown) => void; info: (t: string) => void };
  confirm: (o: ConfirmOpts) => Promise<false | string>;
}
const UiContext = createContext<UiCtx>(null as any);
export const useUi = () => useContext(UiContext);
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'Đã xảy ra lỗi');

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve: (v: false | string) => void }) | null>(null);
  const [inputVal, setInputVal] = useState('');
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const toast = { success: (t: string) => push('success', t), error: (t: unknown) => push('error', errMsg(t)), info: (t: string) => push('info', t) };
  const confirm = (o: ConfirmOpts) => new Promise<false | string>((resolve) => { setInputVal(''); setConfirmState({ ...o, resolve }); });
  const close = (v: false | string) => { confirmState?.resolve(v); setConfirmState(null); };
  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      {createPortal(
        <div className="fixed z-[100] top-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-end pointer-events-none">
          {toasts.map((t) => (
            <div key={t.id} className={cx('pointer-events-auto animate-fade-in flex items-start gap-2.5 max-w-sm w-full sm:w-auto rounded-xl px-4 py-3 text-sm shadow-lg border',
              t.kind === 'success' && 'bg-ink-900 text-ivory-50 border-ink-700', t.kind === 'error' && 'bg-red-50 text-red-800 border-red-200', t.kind === 'info' && 'bg-white text-ink-800 border-ivory-300')}>
              {t.kind === 'success' ? <CheckCircle2 size={18} className="text-gold-300 shrink-0" /> : t.kind === 'error' ? <XCircle size={18} className="shrink-0" /> : <Info size={18} className="shrink-0 text-gold-500" />}
              <span className="whitespace-pre-line">{t.text}</span>
            </div>
          ))}
        </div>, document.body)}
      {confirmState && (
        <Modal open title={confirmState.title} onClose={() => close(false)} size="sm"
          footer={<>
            <button className="btn-outline" onClick={() => close(false)}>Không</button>
            <button className={confirmState.danger ? 'btn-danger' : 'btn-primary'} autoFocus={!confirmState.input}
              disabled={!!confirmState.input?.required && !inputVal.trim()} onClick={() => close(confirmState.input ? inputVal.trim() : 'ok')}>
              {confirmState.confirmText ?? 'Đồng ý'}
            </button>
          </>}>
          <div className="flex gap-3">
            {confirmState.danger && <AlertTriangle className="text-red-500 shrink-0" size={22} />}
            <div className="text-sm text-ink-600 flex-1 space-y-3">
              {confirmState.message && <div>{confirmState.message}</div>}
              {confirmState.input && (
                <Field label={confirmState.input.label}>
                  <input className="input" autoFocus value={inputVal} placeholder={confirmState.input.placeholder} onChange={(e) => setInputVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (!confirmState.input?.required || inputVal.trim())) close(inputVal.trim()); }} />
                </Field>
              )}
            </div>
          </div>
        </Modal>
      )}
    </UiContext.Provider>
  );
}

// =================================================================== Modal
export function Modal({ open, title, onClose, children, footer, size = 'md', subtitle }: {
  open: boolean; title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-[96vw]' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-950/50 backdrop-blur-[2px] sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('animate-fade-in bg-white w-full rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[94vh]', w)} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-ivory-200">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink-900">{title}</h3>
            {subtitle && <div className="text-xs text-ink-400 mt-0.5">{subtitle}</div>}
          </div>
          <button className="btn-ghost btn-icon -mr-2" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="px-5 sm:px-6 py-5 overflow-y-auto scroll-thin flex-1">{children}</div>
        {footer && <div className="px-5 sm:px-6 py-3.5 border-t border-ivory-200 flex flex-wrap justify-end gap-2 bg-ivory-50 rounded-b-2xl">{footer}</div>}
      </div>
    </div>, document.body);
}

// =================================================================== Form
export function Field({ label, children, hint, error, className, required }: { label?: ReactNode; children: ReactNode; hint?: ReactNode; error?: string; className?: string; required?: boolean }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}{required && <span className="text-red-500"> *</span>}</span>}
      {children}
      {hint && !error && <span className="block text-[11px] text-ink-400 mt-1">{hint}</span>}
      {error && <span className="block text-[11px] text-red-600 mt-1">{error}</span>}
    </label>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx('input', p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx('input', p.className)} />;
export function Select({ options, placeholder, className, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string }[]; placeholder?: string }) {
  return (
    <select {...p} className={cx('input pr-8', className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Ô nhập tiền: hiển thị phân cách hàng nghìn */
export function MoneyInput({ value, onChange, className, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null | undefined; onChange: (v: number) => void; ref?: React.Ref<HTMLInputElement> }) {
  const display = value === null || value === undefined || (value === 0 && p.placeholder) ? '' : Number(value).toLocaleString('vi-VN');
  return (
    <div className="relative">
      <input {...p} inputMode="numeric" className={cx('input pr-8 text-right tabular-nums', className)} value={display}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^\d]/g, '')) || 0)} onFocus={(e) => e.target.select()} />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-300 pointer-events-none">đ</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative w-10 h-6 rounded-full transition', checked ? 'bg-gold-400' : 'bg-ivory-400')}>
        <span className={cx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition', checked && 'translate-x-4')} />
      </button>
      {label && <span className="text-sm text-ink-700">{label}</span>}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Tìm kiếm...', className, autoFocus, delay = 300 }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; delay?: number }) {
  const [v, setV] = useState(value);
  const first = useRef(true);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { if (v !== value) onChange(v); }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <div className={cx('relative', className)}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
      <input className="input pl-9" value={v} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => setV(e.target.value)} />
      {v && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-600" onClick={() => { setV(''); onChange(''); }}><X size={14} /></button>}
    </div>
  );
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const t = today();
  const presets: [string, string, string][] = [
    ['Hôm nay', t, t], ['7 ngày', addDays(t, -6), t], ['30 ngày', addDays(t, -29), t], ['Tháng này', monthStart(), t],
    ['Tháng trước', (() => { const d = new Date(monthStart() + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })(), addDays(monthStart(), -1)],
    ['Năm nay', t.slice(0, 4) + '-01-01', t],
  ];
  const active = presets.find((p) => p[1] === from && p[2] === to)?.[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 bg-white border border-ivory-300 rounded-xl p-1">
        {presets.map(([l, f, tt]) => (
          <button key={l} className={cx('px-2.5 h-7 rounded-lg text-xs font-medium transition', active === l ? 'bg-ink-900 text-ivory-50' : 'text-ink-500 hover:bg-ivory-200')} onClick={() => onChange(f, tt)}>{l}</button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input type="date" className="input h-9 w-[140px]" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to)} />
        <span className="text-ink-300">→</span>
        <input type="date" className="input h-9 w-[140px]" value={to} min={from} onChange={(e) => e.target.value && onChange(from, e.target.value)} />
      </div>
    </div>
  );
}

// =================================================================== Hiển thị
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="font-display text-[28px] leading-tight font-semibold text-ink-900">{title}</h1>
        {subtitle && <p className="text-sm text-ink-400 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  gray: 'bg-ivory-200 text-ink-600', gold: 'bg-gold-100 text-gold-700', green: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-700',
  blue: 'bg-sky-50 text-sky-700', amber: 'bg-amber-50 text-amber-700', dark: 'bg-ink-900 text-gold-200', violet: 'bg-violet-50 text-violet-700',
};
export const Badge = ({ tone = 'gray', children, className }: { tone?: keyof typeof TONES | string; children: ReactNode; className?: string }) =>
  <span className={cx('chip', TONES[tone] ?? TONES.gray, className)}>{children}</span>;

export const Spinner = ({ size = 18, className }: { size?: number; className?: string }) => <Loader2 size={size} className={cx('animate-spin text-gold-500', className)} />;
export const Loading = ({ text = 'Đang tải dữ liệu...' }: { text?: string }) => (
  <div className="flex items-center justify-center gap-2 py-14 text-sm text-ink-400"><Spinner /> {text}</div>
);
export function Empty({ icon, title = 'Chưa có dữ liệu', children }: { icon?: ReactNode; title?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4">
      <div className="w-12 h-12 rounded-2xl bg-ivory-200 flex items-center justify-center text-ink-400 mb-3">{icon ?? <Info size={22} />}</div>
      <div className="text-sm font-medium text-ink-600">{title}</div>
      {children && <div className="text-xs text-ink-400 mt-1 max-w-sm">{children}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total > 0 ? <div className="px-4 py-3 text-xs text-ink-400">{total} bản ghi</div> : null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-ink-400">
      <span>{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} / {total.toLocaleString('vi-VN')}</span>
      <div className="flex items-center gap-1">
        <button className="btn-outline btn-sm btn-icon w-8 h-8" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={14} /></button>
        <span className="px-2 tabular-nums">{page}/{pages}</span>
        <button className="btn-outline btn-sm btn-icon w-8 h-8" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto scroll-thin border-b border-ivory-300', className)}>
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cx('px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition', value === t.value ? 'border-gold-400 text-ink-900' : 'border-transparent text-ink-400 hover:text-ink-700')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-[11px] text-ink-300">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatCard({ label, value, sub, icon, tone = 'light', onClick }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'light' | 'dark'; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cx('rounded-2xl p-4 sm:p-5 border transition', onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md',
      tone === 'dark' ? 'bg-ink-900 border-ink-800 text-ivory-50' : 'bg-white border-ivory-300/70')}>
      <div className="flex items-start justify-between gap-2">
        <div className={cx('text-[11px] font-semibold uppercase tracking-[0.12em]', tone === 'dark' ? 'text-gold-300' : 'text-ink-400')}>{label}</div>
        {icon && <div className={cx('w-8 h-8 rounded-xl flex items-center justify-center', tone === 'dark' ? 'bg-ink-700 text-gold-300' : 'bg-gold-50 text-gold-600')}>{icon}</div>}
      </div>
      <div className={cx('mt-2 text-xl sm:text-2xl font-semibold tabular-nums tracking-tight', tone === 'dark' ? 'text-ivory-50' : 'text-ink-900')}>{value}</div>
      {sub && <div className={cx('mt-1 text-xs', tone === 'dark' ? 'text-ink-300' : 'text-ink-400')}>{sub}</div>}
    </div>
  );
}

export function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-ivory-200 last:border-0 text-sm">
      <span className="text-ink-400 shrink-0">{label}</span>
      <span className="text-ink-800 text-right font-medium min-w-0 break-words">{children ?? '—'}</span>
    </div>
  );
}

// =================================================================== Hooks
/** Tải dữ liệu, tự tải lại khi deps đổi */
export function useFetch<T = any>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const r = await fn();
      if (id === seq.current) { setData(r); setError(null); }
    } catch (e) {
      if (id === seq.current) setError(errMsg(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load, setData };
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 m-4 p-4 rounded-xl bg-red-50 text-red-700 text-sm border border-red-100">
      <XCircle size={18} /> <span className="flex-1">{error}</span>
      {onRetry && <button className="btn-outline btn-sm" onClick={onRetry}>Thử lại</button>}
    </div>
  );
}

/** Ẩn/hiện theo quyền */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast.success(success);
      return r;
    } catch (e) {
      toast.error(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

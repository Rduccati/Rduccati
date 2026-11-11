import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { errMsg, Spinner, useUi } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const { toast } = useUi();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [store, setStore] = useState<{ name: string; logo: string | null }>({ name: 'WATCH POS', logo: null });
  useEffect(() => { api.get('/public/store').then(setStore).catch(() => {}); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await login(u.trim(), p);
      if (r.must_change_password) toast.info('Bạn đang dùng mật khẩu mặc định. Hãy đổi mật khẩu trong Cài đặt → Tài khoản.');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full grid lg:grid-cols-[1.1fr_1fr] bg-ink-900">
      <div className="hidden lg:flex relative overflow-hidden flex-col justify-between p-14 text-ivory-100">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'repeating-radial-gradient(circle at 70% 60%, #c9a96e 0 1px, transparent 1px 28px)' }} />
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-gold-300 to-gold-600 flex items-center justify-center">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#161513" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="7" /><path d="M12 8v4l2.5 1.5" /></svg>
          </div>
          <span className="text-[11px] uppercase tracking-[0.35em] text-gold-400">Watch Retail Suite</span>
        </div>
        <div className="relative">
          <h1 className="font-display text-6xl leading-[1.05] font-semibold">{store.name}</h1>
          <p className="mt-5 text-ink-300 max-w-md leading-relaxed">Quản lý bán hàng chuyên biệt cho cửa hàng đồng hồ – serial từng chiếc, bảo hành, sửa chữa, kho và tài chính trong một hệ thống.</p>
        </div>
        <div className="relative text-xs text-ink-400">© {new Date().getFullYear()} WATCH POS · Dữ liệu lưu trữ tại cửa hàng của bạn</div>
      </div>
      <div className="flex items-center justify-center p-6 bg-ivory-100 lg:rounded-l-[36px]">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <div className="font-display text-4xl font-semibold text-ink-900">{store.name}</div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-gold-600 mt-1">Watch Retail</div>
          </div>
          <h2 className="text-2xl font-semibold text-ink-900">Đăng nhập</h2>
          <p className="text-sm text-ink-400 mt-1 mb-7">Nhập tài khoản được cấp để bắt đầu ca làm việc.</p>
          <label className="label">Tên đăng nhập</label>
          <div className="relative mb-4">
            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
            <input className="input h-11 pl-9" autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} placeholder="admin" />
          </div>
          <label className="label">Mật khẩu</label>
          <div className="relative mb-2">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
            <input className="input h-11 pl-9 pr-10" type={show ? 'text' : 'password'} autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} placeholder="••••••" />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-600" onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mt-3">{err}</div>}
          <button className="btn-primary w-full h-11 mt-6" disabled={busy || !u || !p}>{busy ? <Spinner /> : 'Đăng nhập'}</button>
          <p className="text-xs text-ink-400 mt-6 text-center">Lần đầu sử dụng: <b>admin</b> / <b>admin123</b> — hãy đổi mật khẩu ngay sau khi đăng nhập.</p>
        </form>
      </div>
    </div>
  );
}

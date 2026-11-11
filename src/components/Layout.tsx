import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Receipt, Watch, Warehouse, Barcode, Users, ShieldCheck, Truck, Wallet, BarChart3, UserCog, Clock, Settings,
  LogOut, Menu, X, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { cx } from './ui';

export const NAV: { to: string; label: string; icon: ReactNode; perms: string[]; group?: string }[] = [
  { to: '/', label: 'Tổng quan', icon: <LayoutDashboard size={18} />, perms: ['dashboard.view'] },
  { to: '/pos', label: 'Bán hàng (POS)', icon: <ShoppingBag size={18} />, perms: ['pos.sell'] },
  { to: '/orders', label: 'Đơn hàng', icon: <Receipt size={18} />, perms: ['orders.view', 'pos.sell'] },
  { to: '/products', label: 'Sản phẩm', icon: <Watch size={18} />, perms: ['products.view'], group: 'Hàng hóa' },
  { to: '/inventory', label: 'Kho hàng', icon: <Warehouse size={18} />, perms: ['inventory.view'], group: 'Hàng hóa' },
  { to: '/labels', label: 'Mã vạch & In tem', icon: <Barcode size={18} />, perms: ['products.view'], group: 'Hàng hóa' },
  { to: '/suppliers', label: 'Nhà cung cấp', icon: <Truck size={18} />, perms: ['suppliers.view'], group: 'Hàng hóa' },
  { to: '/customers', label: 'Khách hàng', icon: <Users size={18} />, perms: ['customers.view'], group: 'Khách hàng' },
  { to: '/warranty', label: 'Bảo hành & Sửa chữa', icon: <ShieldCheck size={18} />, perms: ['warranty.view'], group: 'Khách hàng' },
  { to: '/finance', label: 'Thu chi & Sổ quỹ', icon: <Wallet size={18} />, perms: ['finance.view'], group: 'Quản trị' },
  { to: '/reports', label: 'Báo cáo', icon: <BarChart3 size={18} />, perms: ['reports.view'], group: 'Quản trị' },
  { to: '/staff', label: 'Nhân viên', icon: <UserCog size={18} />, perms: ['staff.view'], group: 'Quản trị' },
  { to: '/attendance', label: 'Chấm công', icon: <Clock size={18} />, perms: [], group: 'Quản trị' },
  { to: '/settings', label: 'Cài đặt', icon: <Settings size={18} />, perms: [], group: 'Quản trị' },
];

function Logo({ compact, name }: { compact?: boolean; name: string }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-300 to-gold-600 flex items-center justify-center shadow-inner shrink-0">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#161513" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="7" /><path d="M12 8v4l2.5 1.5" /></svg>
      </div>
      {!compact && (
        <div className="min-w-0">
          <div className="font-display text-xl leading-none font-semibold text-ivory-50 tracking-wide truncate">{name}</div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold-400 mt-1">Watch Retail</div>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, can, settings } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('watchpos_sidebar') === '1'; } catch { return false; } });
  const isPos = loc.pathname.startsWith('/pos');
  const compact = collapsed || isPos;
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => { try { localStorage.setItem('watchpos_sidebar', collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);

  // Phím tắt toàn cục: F2 → POS
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'F2' && can('pos.sell')) { e.preventDefault(); nav('/pos'); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [nav, can]);

  const items = NAV.filter((n) => n.perms.length === 0 || can(...n.perms));
  const storeName = settings.store?.name || 'WATCH POS';

  const sidebar = (mobile: boolean) => (
    <div className="flex flex-col h-full">
      <div className={cx('h-16 flex items-center border-b border-ink-700/60', compact && !mobile ? 'justify-center px-2' : 'px-4 justify-between')}>
        <Logo compact={compact && !mobile} name={storeName} />
        {mobile && <button className="text-ink-300 p-2" onClick={() => setMobileOpen(false)}><X size={20} /></button>}
      </div>
      <nav className="flex-1 overflow-y-auto scroll-thin py-3 px-2.5">
        {items.map((n, i) => {
          const showGroup = n.group && n.group !== items[i - 1]?.group && (!compact || mobile);
          return (
            <div key={n.to}>
              {showGroup && <div className="px-3 pt-4 pb-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-400 font-semibold">{n.group}</div>}
              <NavLink to={n.to} end={n.to === '/'} title={n.label}
                className={({ isActive }) => cx('group flex items-center gap-3 rounded-xl text-[13.5px] font-medium transition mb-0.5',
                  compact && !mobile ? 'justify-center h-11 w-11 mx-auto' : 'px-3 h-10',
                  isActive ? 'bg-gradient-to-r from-gold-400/20 to-gold-400/5 text-gold-200 shadow-[inset_2px_0_0_var(--color-gold-400)]' : 'text-ink-300 hover:text-ivory-100 hover:bg-ink-800')}>
                <span className="shrink-0">{n.icon}</span>
                {(!compact || mobile) && <span className="truncate">{n.label}</span>}
              </NavLink>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-ink-700/60 p-2.5">
        {(!compact || mobile) ? (
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-9 h-9 rounded-full bg-ink-700 text-gold-300 flex items-center justify-center text-sm font-semibold shrink-0">{user?.full_name?.[0] ?? '?'}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ivory-100 truncate">{user?.full_name}</div>
              <div className="text-[11px] text-ink-400 truncate">{user?.role_name}</div>
            </div>
            <button className="p-2 rounded-lg text-ink-400 hover:text-gold-300 hover:bg-ink-800" title="Đăng xuất" onClick={logout}><LogOut size={17} /></button>
          </div>
        ) : (
          <button className="w-11 h-11 mx-auto flex items-center justify-center rounded-xl text-ink-400 hover:text-gold-300 hover:bg-ink-800" title="Đăng xuất" onClick={logout}><LogOut size={17} /></button>
        )}
        {!mobile && !isPos && (
          <button className="hidden lg:flex w-full items-center justify-center h-8 mt-1 rounded-lg text-ink-500 hover:text-ink-300" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Mở rộng' : 'Thu gọn'}>
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex">
      <aside className={cx('hidden lg:block bg-ink-900 shrink-0 transition-[width] duration-200', compact ? 'w-[76px]' : 'w-[248px]')}>{sidebar(false)}</aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-[272px] max-w-[85vw] bg-ink-900 h-full animate-fade-in">{sidebar(true)}</aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden h-14 bg-ink-900 flex items-center justify-between px-3 shrink-0">
          <button className="p-2 text-ivory-100" onClick={() => setMobileOpen(true)} aria-label="Menu"><Menu size={22} /></button>
          <div className="font-display text-lg text-ivory-50 font-semibold">{storeName}</div>
          <div className="w-10" />
        </header>
        <main className={cx('flex-1 min-h-0', isPos ? 'overflow-hidden' : 'overflow-y-auto scroll-thin')}>
          {isPos ? children : <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">{children}</div>}
        </main>
      </div>
    </div>
  );
}

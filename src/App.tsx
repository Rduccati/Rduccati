import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import { Empty, Loading } from './components/ui';
import Login from './pages/Login';
import { ShieldAlert } from 'lucide-react';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Pos = lazy(() => import('./pages/Pos'));
const Orders = lazy(() => import('./pages/Orders'));
const Products = lazy(() => import('./pages/Products'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Labels = lazy(() => import('./pages/Labels'));
const Customers = lazy(() => import('./pages/Customers'));
const Warranty = lazy(() => import('./pages/Warranty'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Finance = lazy(() => import('./pages/Finance'));
const Reports = lazy(() => import('./pages/Reports'));
const Staff = lazy(() => import('./pages/Staff'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Settings = lazy(() => import('./pages/Settings'));

function Guard({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (perms.length && !can(...perms)) return <Empty icon={<ShieldAlert size={22} />} title="Bạn không có quyền truy cập chức năng này">Liên hệ quản trị viên để được cấp quyền.</Empty>;
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <Dashboard />;
  if (can('pos.sell')) return <Navigate to="/pos" replace />;
  if (can('inventory.view')) return <Navigate to="/inventory" replace />;
  return <Navigate to="/attendance" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="h-full flex items-center justify-center bg-ink-900"><Loading text="Đang khởi động WATCH POS..." /></div>;
  if (!user) return <Login />;
  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pos" element={<Guard perms={['pos.sell']}><Pos /></Guard>} />
          <Route path="/orders" element={<Guard perms={['orders.view', 'pos.sell']}><Orders /></Guard>} />
          <Route path="/products" element={<Guard perms={['products.view']}><Products /></Guard>} />
          <Route path="/inventory" element={<Guard perms={['inventory.view']}><Inventory /></Guard>} />
          <Route path="/labels" element={<Guard perms={['products.view']}><Labels /></Guard>} />
          <Route path="/customers" element={<Guard perms={['customers.view']}><Customers /></Guard>} />
          <Route path="/warranty" element={<Guard perms={['warranty.view']}><Warranty /></Guard>} />
          <Route path="/suppliers" element={<Guard perms={['suppliers.view']}><Suppliers /></Guard>} />
          <Route path="/finance" element={<Guard perms={['finance.view']}><Finance /></Guard>} />
          <Route path="/reports" element={<Guard perms={['reports.view']}><Reports /></Guard>} />
          <Route path="/staff" element={<Guard perms={['staff.view']}><Staff /></Guard>} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Empty title="Không tìm thấy trang" />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { db, DATA_DIR, ROOT_DIR } from './db.ts';
import { errorHandler, AppError } from './core.ts';
import { publicRouter, router as systemRouter } from './routes/system.ts';
import { router as partnersRouter } from './routes/partners.ts';
import { router as productsRouter } from './routes/products.ts';
import { router as inventoryRouter } from './routes/inventory.ts';
import { router as salesRouter } from './routes/sales.ts';
import { router as warrantyRouter } from './routes/warranty.ts';
import { router as financeRouter } from './routes/finance.ts';
import { router as attendanceRouter } from './routes/attendance.ts';
import { router as printingRouter } from './routes/printing.ts';

export const DEFAULT_ROLES = [
  { code: 'admin', name: 'Quản trị hệ thống', permissions: ['*'] },
  {
    code: 'manager', name: 'Quản lý cửa hàng', permissions: [
      'dashboard.view', 'products.view', 'products.edit', 'products.delete', 'products.cost', 'inventory.view', 'inventory.edit', 'pos.sell', 'orders.view',
      'orders.cancel', 'orders.return', 'promotions.edit', 'customers.view', 'customers.edit', 'warranty.view', 'warranty.edit', 'suppliers.view', 'suppliers.edit',
      'finance.view', 'finance.edit', 'reports.view', 'staff.view', 'audit.view'],
  },
  { code: 'sales', name: 'Nhân viên bán hàng', permissions: ['products.view', 'pos.sell', 'customers.view', 'customers.edit', 'warranty.view', 'warranty.edit'] },
  { code: 'warehouse', name: 'Quản lý kho', permissions: ['products.view', 'products.edit', 'products.cost', 'inventory.view', 'inventory.edit', 'suppliers.view', 'suppliers.edit'] },
];

export const DEFAULT_SETTINGS: Record<string, any> = {
  store: { name: 'WATCH POS', slogan: 'Luxury Timepieces', address: '123 Đồng Khởi, Quận 1, TP. Hồ Chí Minh', phone: '0909 000 000', email: '', website: '', tax_code: '', logo: null, bank_name: '', bank_account: '', bank_owner: '' },
  invoice: { paper: 'K80', show_logo: true, show_customer: true, show_barcode: true, show_warranty: true, footer: 'Cảm ơn quý khách! Hẹn gặp lại.\nĐổi trả trong 7 ngày với sản phẩm còn nguyên tem, hộp, phụ kiện.' },
  label: { width_mm: 50, height_mm: 30, columns: 3, gap_mm: 2, show_brand: true, show_model: true, show_price: true, show_sku: true, show_barcode: true, show_name: false, font_size: 8 },
  barcode: { type: 'EAN13', ean_prefix: '20', code128_prefix: 'WP', sku_prefix: '' },
  printer: { driver: 'browser', receipt_paper: 'K80', escpos_connection: 'none', escpos_address: '', auto_print_after_sale: false },
  inventory: { aging_days: 180 },
  maintenance: { interval_months: 36 },
  attendance: { store_lat: null, store_lng: null, radius_m: 200, require_location: false },
  finance: { opening_cash: 0, opening_bank: 0 },
};

/** Khởi tạo dữ liệu nền: vai trò, cài đặt, kho, tài khoản admin */
export async function bootstrap() {
  const q = db();
  for (const r of DEFAULT_ROLES) {
    await q.query(`INSERT INTO roles(code, name, permissions, is_system) VALUES ($1,$2,$3,true) ON CONFLICT (code) DO NOTHING`, [r.code, r.name, JSON.stringify(r.permissions)]);
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await q.query(`INSERT INTO settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [k, JSON.stringify(v)]);
  }
  const wh = await q.query(`SELECT count(*) c FROM warehouses`);
  if (wh.rows[0].c === 0) await q.query(`INSERT INTO warehouses(code, name, address, is_default) VALUES ('KHO01','Cửa hàng chính',NULL,true)`);
  const ws = await q.query(`SELECT count(*) c FROM work_shifts`);
  if (ws.rows[0].c === 0) {
    await q.query(`INSERT INTO work_shifts(name, start_time, end_time, grace_minutes) VALUES ('Ca sáng','08:30','15:00',10),('Ca chiều','15:00','22:00',10),('Ca hành chính','09:00','18:00',10)`);
  }
  const users = await q.query(`SELECT count(*) c FROM users`);
  if (users.rows[0].c === 0) {
    const role = (await q.query(`SELECT id FROM roles WHERE code='admin'`)).rows[0];
    await q.query(`INSERT INTO users(username, password_hash, full_name, role_id) VALUES ('admin',$1,'Quản trị viên',$2)`, [await bcrypt.hash('admin123', 10), role.id]);
    console.log('[bootstrap] Tạo tài khoản mặc định: admin / admin123 (hãy đổi mật khẩu sau khi đăng nhập)');
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
  app.use(express.json({ limit: '40mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    await db().query('SELECT 1');
    res.json({ ok: true, db: db().kind, time: new Date().toISOString() });
  });
  app.use('/api', publicRouter);
  app.use('/api', systemRouter); // gắn authenticate cho toàn bộ route phía sau
  app.use('/api', partnersRouter);
  app.use('/api', productsRouter);
  app.use('/api', inventoryRouter);
  app.use('/api', salesRouter);
  app.use('/api', warrantyRouter);
  app.use('/api', financeRouter);
  app.use('/api', attendanceRouter);
  app.use('/api', printingRouter);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'API không tồn tại')));

  app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '30d' }));

  const dist = path.join(ROOT_DIR, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}

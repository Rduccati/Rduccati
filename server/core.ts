import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { db, DATA_DIR, type Queryable } from './db.ts';

// ------------------------------------------------------------------ Lỗi
export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new AppError(400, m, d);
export const notFound = (m = 'Không tìm thấy dữ liệu') => new AppError(404, m);

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ: ' + issues.map((i) => `${i.field || 'dữ liệu'} – ${i.message}`).join('; '), issues });
  }
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, details: err.details });
  // Lỗi PostgreSQL
  if (err?.code === '23505') {
    const m = /Key \((.+?)\)=\((.+?)\)/.exec(err.detail || '');
    return res.status(409).json({ error: m ? `Giá trị "${m[2]}" của trường ${m[1]} đã tồn tại` : 'Dữ liệu bị trùng lặp' });
  }
  if (err?.code === '23503') return res.status(409).json({ error: 'Dữ liệu đang được sử dụng ở nơi khác, không thể xóa/thay đổi' });
  if (err?.code === '23514') return res.status(400).json({ error: 'Giá trị không hợp lệ (vi phạm ràng buộc dữ liệu)' });
  if (err?.code === 'P0001') return res.status(400).json({ error: err.message });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Lỗi hệ thống: ' + (err?.message || 'không xác định') });
}

// ------------------------------------------------------------------ Phân quyền
export const PERMISSIONS: { key: string; label: string; group: string }[] = [
  { key: 'dashboard.view', label: 'Xem tổng quan', group: 'Tổng quan' },
  { key: 'products.view', label: 'Xem sản phẩm', group: 'Sản phẩm' },
  { key: 'products.edit', label: 'Thêm/sửa sản phẩm', group: 'Sản phẩm' },
  { key: 'products.delete', label: 'Xóa sản phẩm', group: 'Sản phẩm' },
  { key: 'products.cost', label: 'Xem giá nhập/giá vốn', group: 'Sản phẩm' },
  { key: 'inventory.view', label: 'Xem kho', group: 'Kho' },
  { key: 'inventory.edit', label: 'Nhập/xuất/chuyển/kiểm kho', group: 'Kho' },
  { key: 'pos.sell', label: 'Bán hàng POS', group: 'Bán hàng' },
  { key: 'orders.view', label: 'Xem đơn hàng', group: 'Bán hàng' },
  { key: 'orders.cancel', label: 'Hủy đơn hàng', group: 'Bán hàng' },
  { key: 'orders.return', label: 'Trả hàng / hoàn tiền', group: 'Bán hàng' },
  { key: 'promotions.edit', label: 'Quản lý khuyến mãi', group: 'Bán hàng' },
  { key: 'customers.view', label: 'Xem khách hàng', group: 'Khách hàng' },
  { key: 'customers.edit', label: 'Thêm/sửa khách hàng', group: 'Khách hàng' },
  { key: 'warranty.view', label: 'Xem bảo hành/sửa chữa', group: 'Bảo hành' },
  { key: 'warranty.edit', label: 'Tạo/cập nhật bảo hành, sửa chữa', group: 'Bảo hành' },
  { key: 'suppliers.view', label: 'Xem nhà cung cấp', group: 'Nhà cung cấp' },
  { key: 'suppliers.edit', label: 'Quản lý nhà cung cấp', group: 'Nhà cung cấp' },
  { key: 'finance.view', label: 'Xem thu chi', group: 'Tài chính' },
  { key: 'finance.edit', label: 'Lập phiếu thu/chi', group: 'Tài chính' },
  { key: 'reports.view', label: 'Xem báo cáo', group: 'Báo cáo' },
  { key: 'staff.view', label: 'Xem nhân viên & chấm công', group: 'Nhân viên' },
  { key: 'staff.edit', label: 'Quản lý nhân viên, phân quyền', group: 'Nhân viên' },
  { key: 'settings.edit', label: 'Cài đặt hệ thống', group: 'Hệ thống' },
  { key: 'backup.manage', label: 'Sao lưu / khôi phục dữ liệu', group: 'Hệ thống' },
  { key: 'audit.view', label: 'Xem lịch sử thao tác', group: 'Hệ thống' },
];

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role_code: string;
  role_name: string;
  permissions: string[];
}
declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

let secretCache: string | null = null;
export function jwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (secretCache) return secretCache;
  const file = path.join(DATA_DIR, 'jwt.secret');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  secretCache = fs.readFileSync(file, 'utf8').trim();
  return secretCache;
}

export function signToken(userId: number) {
  return jwt.sign({ uid: userId }, jwtSecret(), { expiresIn: '12h' });
}

export async function loadAuthUser(userId: number): Promise<AuthUser | null> {
  const r = await db().query(
    `SELECT u.id, u.username, u.full_name, u.is_active, r.code role_code, r.name role_name, r.permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId],
  );
  const u = r.rows[0];
  if (!u || !u.is_active) return null;
  return { id: u.id, username: u.username, full_name: u.full_name, role_code: u.role_code, role_name: u.role_name, permissions: u.permissions };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token as string | undefined);
  if (!token) return next(new AppError(401, 'Vui lòng đăng nhập'));
  try {
    const payload = jwt.verify(token, jwtSecret()) as { uid: number };
    const user = await loadAuthUser(payload.uid);
    if (!user) return next(new AppError(401, 'Tài khoản không tồn tại hoặc đã bị khóa'));
    req.user = user;
    next();
  } catch {
    next(new AppError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại'));
  }
}

export function hasPerm(user: AuthUser | undefined, perm: string) {
  if (!user) return false;
  return user.permissions.includes('*') || user.permissions.includes(perm);
}

export function requirePerm(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (perms.some((p) => hasPerm(req.user, p))) return next();
    next(new AppError(403, 'Bạn không có quyền thực hiện chức năng này'));
  };
}

// ------------------------------------------------------------------ Nhật ký
export async function audit(
  req: Request | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  description: string,
  detail?: unknown,
  q: Queryable = db(),
) {
  await q.query(
    `INSERT INTO audit_logs(user_id, action, entity, entity_id, description, detail, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req?.user?.id ?? null, action, entity, entityId == null ? null : String(entityId), description,
     detail === undefined ? null : JSON.stringify(detail), req?.ip ?? null],
  );
}

// ------------------------------------------------------------------ Tiện ích
export const zMoney = z.coerce.number().int('Số tiền phải là số nguyên').min(0, 'Số tiền không được âm');
export const zId = z.coerce.number().int().positive();
export const zOptStr = z.string().trim().max(2000).optional().nullable().transform((v) => (v ? v : null));
export const zOptDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}/.test(v), 'Ngày không hợp lệ (YYYY-MM-DD)');

export function paging(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function dateRange(req: Request) {
  const from = (req.query.from as string) || null;
  const to = (req.query.to as string) || null;
  return { from, to };
}

export async function getSetting<T = any>(key: string, fallback: T, q: Queryable = db()): Promise<T> {
  const r = await q.query(`SELECT value FROM settings WHERE key=$1`, [key]);
  return r.rows[0] ? (r.rows[0].value as T) : fallback;
}

/** Ghi sổ kho: là con đường DUY NHẤT làm thay đổi tồn kho */
export async function postMovement(
  q: Queryable,
  m: {
    product_id: number; warehouse_id: number; serial_id?: number | null; qty_change: number; unit_cost?: number;
    ref_type: string; ref_id?: number | null; ref_code?: string | null; note?: string | null; user_id?: number | null;
  },
) {
  const r = await q.query(
    `INSERT INTO stock_movements(product_id, warehouse_id, serial_id, qty_change, unit_cost, ref_type, ref_id, ref_code, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING balance_after`,
    [m.product_id, m.warehouse_id, m.serial_id ?? null, m.qty_change, m.unit_cost ?? 0, m.ref_type, m.ref_id ?? null,
     m.ref_code ?? null, m.note ?? null, m.user_id ?? null],
  );
  return r.rows[0].balance_after as number;
}

export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

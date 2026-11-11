import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { z } from 'zod';
import { db, DATA_DIR } from '../db.ts';
import {
  AppError, audit, authenticate, badRequest, notFound, PERMISSIONS, requirePerm, signToken, loadAuthUser, paging, zOptStr,
} from '../core.ts';
import { BACKUP_TABLES, createBackupFile, dumpDatabase, restoreDatabase, clearBusinessData } from '../services/backup.ts';

export const publicRouter = Router();
export const router = Router();

// ------------------------------------------------------------------ Đăng nhập (chống dò mật khẩu đơn giản)
const attempts = new Map<string, { count: number; until: number }>();
publicRouter.post('/auth/login', async (req, res) => {
  const { username, password } = z.object({ username: z.string().trim().min(1, 'Nhập tên đăng nhập'), password: z.string().min(1, 'Nhập mật khẩu') }).parse(req.body);
  const key = username.toLowerCase() + '|' + req.ip;
  const a = attempts.get(key);
  if (a && a.until > Date.now()) throw new AppError(429, 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 5 phút');
  const r = await db().query(`SELECT id, password_hash, is_active FROM users WHERE lower(username)=lower($1)`, [username]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    const n = (a?.count ?? 0) + 1;
    attempts.set(key, { count: n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    throw new AppError(401, 'Sai tên đăng nhập hoặc mật khẩu');
  }
  if (!u.is_active) throw new AppError(403, 'Tài khoản đã bị khóa');
  attempts.delete(key);
  await db().query(`UPDATE users SET last_login_at=now() WHERE id=$1`, [u.id]);
  const user = await loadAuthUser(u.id);
  req.user = user!;
  await audit(req, 'login', 'user', u.id, `Đăng nhập: ${username}`);
  const defaultPw = await bcrypt.compare('admin123', u.password_hash);
  res.json({ token: signToken(u.id), user, must_change_password: defaultPw });
});

publicRouter.get('/public/store', async (_req, res) => {
  const r = await db().query(`SELECT value FROM settings WHERE key='store'`);
  const s = r.rows[0]?.value ?? {};
  res.json({ name: s.name ?? 'WATCH POS', logo: s.logo ?? null });
});

router.use(authenticate);

router.get('/auth/me', (req, res) => res.json({ user: req.user }));

router.post('/auth/change-password', async (req, res) => {
  const b = z.object({ old_password: z.string().min(1), new_password: z.string().min(6, 'Mật khẩu mới tối thiểu 6 ký tự') }).parse(req.body);
  const u = (await db().query(`SELECT password_hash FROM users WHERE id=$1`, [req.user!.id])).rows[0];
  if (!(await bcrypt.compare(b.old_password, u.password_hash))) throw badRequest('Mật khẩu hiện tại không đúng');
  await db().query(`UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1`, [req.user!.id, await bcrypt.hash(b.new_password, 10)]);
  await audit(req, 'update', 'user', req.user!.id, 'Đổi mật khẩu');
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Phân quyền
router.get('/permissions', (_req, res) => res.json(PERMISSIONS));

router.get('/roles', async (_req, res) => {
  res.json((await db().query(`SELECT r.*, (SELECT count(*) FROM users u WHERE u.role_id=r.id) user_count FROM roles r ORDER BY id`)).rows);
});

const roleSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/, 'Mã chỉ gồm chữ thường, số, gạch dưới'),
  name: z.string().trim().min(2, 'Nhập tên vai trò'),
  permissions: z.array(z.string()).default([]),
});
router.post('/roles', requirePerm('staff.edit'), async (req, res) => {
  const b = roleSchema.parse(req.body);
  const valid = new Set(PERMISSIONS.map((p) => p.key));
  const perms = b.permissions.filter((p) => valid.has(p));
  const r = await db().query(`INSERT INTO roles(code, name, permissions) VALUES ($1,$2,$3) RETURNING *`, [b.code, b.name, JSON.stringify(perms)]);
  await audit(req, 'create', 'role', r.rows[0].id, `Tạo vai trò ${b.name}`);
  res.json(r.rows[0]);
});
router.put('/roles/:id', requirePerm('staff.edit'), async (req, res) => {
  const b = roleSchema.partial().parse(req.body);
  const role = (await db().query(`SELECT * FROM roles WHERE id=$1`, [req.params.id])).rows[0];
  if (!role) throw notFound();
  if (role.code === 'admin') throw badRequest('Không thể sửa quyền của vai trò Quản trị hệ thống');
  const valid = new Set(PERMISSIONS.map((p) => p.key));
  const perms = (b.permissions ?? role.permissions).filter((p: string) => valid.has(p));
  const r = await db().query(`UPDATE roles SET name=$2, permissions=$3 WHERE id=$1 RETURNING *`, [role.id, b.name ?? role.name, JSON.stringify(perms)]);
  await audit(req, 'update', 'role', role.id, `Cập nhật phân quyền ${role.name}`, { permissions: perms });
  res.json(r.rows[0]);
});
router.delete('/roles/:id', requirePerm('staff.edit'), async (req, res) => {
  const role = (await db().query(`SELECT * FROM roles WHERE id=$1`, [req.params.id])).rows[0];
  if (!role) throw notFound();
  if (role.is_system) throw badRequest('Không thể xóa vai trò mặc định của hệ thống');
  await db().query(`DELETE FROM roles WHERE id=$1`, [role.id]);
  await audit(req, 'delete', 'role', role.id, `Xóa vai trò ${role.name}`);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Người dùng
router.get('/users', requirePerm('staff.view', 'staff.edit'), async (_req, res) => {
  res.json((await db().query(
    `SELECT u.id, u.username, u.full_name, u.phone, u.email, u.role_id, u.work_shift_id, u.is_active, u.last_login_at, u.created_at,
            r.name role_name, r.code role_code, ws.name work_shift_name
       FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN work_shifts ws ON ws.id=u.work_shift_id ORDER BY u.id`)).rows);
});
router.get('/users/options', async (_req, res) => {
  res.json((await db().query(`SELECT id, full_name, username FROM users WHERE is_active ORDER BY full_name`)).rows);
});
const userSchema = z.object({
  username: z.string().trim().min(3, 'Tên đăng nhập tối thiểu 3 ký tự').max(40).regex(/^[a-zA-Z0-9_.]+$/, 'Tên đăng nhập không dấu, không khoảng trắng'),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự').optional().or(z.literal('')),
  full_name: z.string().trim().min(2, 'Nhập họ tên'),
  phone: zOptStr, email: zOptStr,
  role_id: z.coerce.number().int().positive('Chọn vai trò'),
  work_shift_id: z.coerce.number().int().positive().optional().nullable(),
  is_active: z.boolean().default(true),
});
router.post('/users', requirePerm('staff.edit'), async (req, res) => {
  const b = userSchema.parse(req.body);
  if (!b.password) throw badRequest('Nhập mật khẩu cho tài khoản mới');
  const r = await db().query(
    `INSERT INTO users(username, password_hash, full_name, phone, email, role_id, work_shift_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [b.username, await bcrypt.hash(b.password, 10), b.full_name, b.phone, b.email, b.role_id, b.work_shift_id ?? null, b.is_active]);
  await audit(req, 'create', 'user', r.rows[0].id, `Tạo tài khoản ${b.username}`);
  res.json(r.rows[0]);
});
router.put('/users/:id', requirePerm('staff.edit'), async (req, res) => {
  const b = userSchema.parse(req.body);
  const id = Number(req.params.id);
  if (id === req.user!.id && !b.is_active) throw badRequest('Không thể tự khóa tài khoản đang đăng nhập');
  const target = (await db().query(`SELECT u.*, r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1`, [id])).rows[0];
  if (!target) throw notFound();
  if (target.role_code === 'admin') {
    const newRole = (await db().query(`SELECT code FROM roles WHERE id=$1`, [b.role_id])).rows[0];
    const admins = (await db().query(`SELECT count(*) c FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='admin' AND u.is_active`)).rows[0].c;
    if ((newRole?.code !== 'admin' || !b.is_active) && admins <= 1) throw badRequest('Hệ thống phải có ít nhất 1 tài khoản Quản trị đang hoạt động');
  }
  await db().query(
    `UPDATE users SET username=$2, full_name=$3, phone=$4, email=$5, role_id=$6, work_shift_id=$7, is_active=$8, updated_at=now() WHERE id=$1`,
    [id, b.username, b.full_name, b.phone, b.email, b.role_id, b.work_shift_id ?? null, b.is_active]);
  if (b.password) await db().query(`UPDATE users SET password_hash=$2 WHERE id=$1`, [id, await bcrypt.hash(b.password, 10)]);
  await audit(req, 'update', 'user', id, `Cập nhật tài khoản ${b.username}${b.password ? ' (đặt lại mật khẩu)' : ''}`);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Cài đặt
const SETTING_KEYS = ['store', 'invoice', 'label', 'barcode', 'printer', 'inventory', 'maintenance', 'attendance', 'finance'];
router.get('/settings', async (_req, res) => {
  const r = await db().query(`SELECT key, value FROM settings`);
  res.json(Object.fromEntries(r.rows.map((x: any) => [x.key, x.value])));
});
router.put('/settings/:key', requirePerm('settings.edit'), async (req, res) => {
  const key = req.params.key as string;
  if (!SETTING_KEYS.includes(key)) throw badRequest('Nhóm cài đặt không hợp lệ');
  if (typeof req.body !== 'object' || Array.isArray(req.body)) throw badRequest('Dữ liệu không hợp lệ');
  await db().query(`INSERT INTO settings(key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, [key, JSON.stringify(req.body)]);
  await audit(req, 'update', 'settings', key, `Cập nhật cài đặt: ${key}`);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Tải ảnh (logo, ảnh sản phẩm)
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)),
});
router.post('/uploads', imageUpload.single('file'), (req, res) => {
  if (!req.file) throw badRequest('Chỉ chấp nhận ảnh PNG/JPG/WEBP/GIF tối đa 5MB');
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ------------------------------------------------------------------ Lịch sử thao tác
router.get('/audit-logs', requirePerm('audit.view'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const cond: string[] = [];
  const p: any[] = [];
  if (req.query.user_id) { p.push(req.query.user_id); cond.push(`a.user_id=$${p.length}`); }
  if (req.query.entity) { p.push(req.query.entity); cond.push(`a.entity=$${p.length}`); }
  if (req.query.q) { p.push(`%${req.query.q}%`); cond.push(`a.description ILIKE $${p.length}`); }
  if (req.query.from) { p.push(req.query.from); cond.push(`a.created_at >= $${p.length}::date`); }
  if (req.query.to) { p.push(req.query.to); cond.push(`a.created_at < $${p.length}::date + 1`); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = (await db().query(`SELECT count(*) c FROM audit_logs a ${where}`, p)).rows[0].c;
  p.push(pageSize, offset);
  const rows = (await db().query(
    `SELECT a.*, u.full_name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where}
     ORDER BY a.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  res.json({ rows, total });
});

// ------------------------------------------------------------------ Sao lưu / khôi phục
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
router.get('/backup/download', requirePerm('backup.manage'), async (req, res) => {
  const dump = await dumpDatabase();
  await audit(req, 'backup', 'system', null, 'Tải xuống bản sao lưu');
  const name = `watchpos-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(JSON.stringify(dump));
});
router.get('/backup/files', requirePerm('backup.manage'), async (_req, res) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const st = fs.statSync(path.join(BACKUP_DIR, f));
    return { name: f, size: st.size, created_at: st.mtime.toISOString() };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(files);
});
router.post('/backup/create', requirePerm('backup.manage'), async (req, res) => {
  const f = await createBackupFile('manual');
  await audit(req, 'backup', 'system', null, `Tạo bản sao lưu ${f}`);
  res.json({ name: f });
});
router.get('/backup/files/:name', requirePerm('backup.manage'), (req, res) => {
  const name = path.basename(req.params.name as string);
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw notFound('Không tìm thấy file sao lưu');
  res.download(file);
});
const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
router.post('/backup/restore', requirePerm('backup.manage'), backupUpload.single('file'), async (req, res) => {
  let data: any;
  try {
    data = req.file ? JSON.parse(req.file.buffer.toString('utf8')) : req.body.file_name
      ? JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, path.basename(req.body.file_name)), 'utf8'))
      : null;
  } catch { throw badRequest('File sao lưu không hợp lệ (không phải JSON)'); }
  if (!data || data.app !== 'WATCH_POS' || typeof data.tables !== 'object') throw badRequest('File không phải bản sao lưu WATCH POS');
  const safety = await createBackupFile('before-restore');
  await restoreDatabase(data);
  await audit(req, 'restore', 'system', null, `Khôi phục dữ liệu từ bản sao lưu ${data.created_at} (bản an toàn: ${safety})`);
  res.json({ ok: true, safety_backup: safety, tables: BACKUP_TABLES.length });
});
router.post('/system/clear-business-data', requirePerm('backup.manage'), async (req, res) => {
  const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
  if (confirm !== 'XOA DU LIEU') throw badRequest('Gõ chính xác "XOA DU LIEU" để xác nhận');
  const safety = await createBackupFile('before-clear');
  await clearBusinessData();
  await audit(req, 'clear', 'system', null, `Xóa dữ liệu mẫu/kinh doanh (bản an toàn: ${safety})`);
  res.json({ ok: true, safety_backup: safety });
});

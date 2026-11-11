/** Danh mục: thương hiệu, kho, nhà cung cấp, khách hàng, khuyến mãi */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db, nextCode } from '../db.ts';
import { audit, badRequest, notFound, paging, requirePerm, zOptDate, zOptStr, escapeLike } from '../core.ts';
import { sendExcel, readExcel } from '../excel.ts';

export const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ------------------------------------------------------------------ Thương hiệu
router.get('/brands', async (_req, res) => {
  res.json((await db().query(`SELECT b.*, (SELECT count(*) FROM products p WHERE p.brand_id=b.id) product_count FROM brands b ORDER BY name`)).rows);
});
const brandSchema = z.object({ name: z.string().trim().min(1, 'Nhập tên thương hiệu'), country: zOptStr });
router.post('/brands', requirePerm('products.edit'), async (req, res) => {
  const b = brandSchema.parse(req.body);
  const r = await db().query(`INSERT INTO brands(name, country) VALUES ($1,$2) RETURNING *`, [b.name, b.country]);
  await audit(req, 'create', 'brand', r.rows[0].id, `Thêm thương hiệu ${b.name}`);
  res.json(r.rows[0]);
});
router.put('/brands/:id', requirePerm('products.edit'), async (req, res) => {
  const b = brandSchema.parse(req.body);
  const r = await db().query(`UPDATE brands SET name=$2, country=$3 WHERE id=$1 RETURNING *`, [req.params.id, b.name, b.country]);
  if (!r.rows[0]) throw notFound();
  await audit(req, 'update', 'brand', req.params.id as string, `Sửa thương hiệu ${b.name}`);
  res.json(r.rows[0]);
});
router.delete('/brands/:id', requirePerm('products.delete'), async (req, res) => {
  const used = (await db().query(`SELECT count(*) c FROM products WHERE brand_id=$1`, [req.params.id])).rows[0].c;
  if (used > 0) throw badRequest(`Thương hiệu đang có ${used} sản phẩm, không thể xóa`);
  await db().query(`DELETE FROM brands WHERE id=$1`, [req.params.id]);
  await audit(req, 'delete', 'brand', req.params.id as string, 'Xóa thương hiệu');
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Kho
router.get('/warehouses', async (_req, res) => {
  res.json((await db().query(
    `SELECT w.*, coalesce((SELECT sum(quantity) FROM stock_levels s WHERE s.warehouse_id=w.id),0) total_qty
       FROM warehouses w ORDER BY is_default DESC, id`)).rows);
});
const whSchema = z.object({
  code: z.string().trim().min(1, 'Nhập mã kho').max(20), name: z.string().trim().min(1, 'Nhập tên kho'),
  address: zOptStr, is_default: z.boolean().default(false), is_active: z.boolean().default(true),
});
router.post('/warehouses', requirePerm('settings.edit', 'inventory.edit'), async (req, res) => {
  const b = whSchema.parse(req.body);
  const r = await db().tx(async (q) => {
    if (b.is_default) await q.query(`UPDATE warehouses SET is_default=false`);
    return q.query(`INSERT INTO warehouses(code, name, address, is_default, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [b.code, b.name, b.address, b.is_default, b.is_active]);
  });
  await audit(req, 'create', 'warehouse', r.rows[0].id, `Thêm kho ${b.name}`);
  res.json(r.rows[0]);
});
router.put('/warehouses/:id', requirePerm('settings.edit', 'inventory.edit'), async (req, res) => {
  const b = whSchema.parse(req.body);
  const r = await db().tx(async (q) => {
    if (b.is_default) await q.query(`UPDATE warehouses SET is_default=false WHERE id<>$1`, [req.params.id]);
    return q.query(`UPDATE warehouses SET code=$2, name=$3, address=$4, is_default=$5, is_active=$6 WHERE id=$1 RETURNING *`,
      [req.params.id, b.code, b.name, b.address, b.is_default, b.is_active]);
  });
  if (!r.rows[0]) throw notFound();
  await audit(req, 'update', 'warehouse', req.params.id as string, `Sửa kho ${b.name}`);
  res.json(r.rows[0]);
});

// ------------------------------------------------------------------ Nhà cung cấp
const supplierDebtSql = `
  s.opening_debt
  + coalesce((SELECT sum(total_amount) FROM stock_documents d WHERE d.supplier_id=s.id AND d.doc_type='import' AND d.status='completed'),0)
  - coalesce((SELECT sum(amount) FROM cash_transactions c WHERE c.supplier_id=s.id AND c.tx_type='payment' AND c.category='supplier_payment'),0)
  + coalesce((SELECT sum(amount) FROM cash_transactions c WHERE c.supplier_id=s.id AND c.tx_type='receipt' AND c.category='supplier_refund'),0)`;

router.get('/suppliers', requirePerm('suppliers.view', 'inventory.view'), async (req, res) => {
  const p: any[] = [];
  let where = '';
  if (req.query.q) { p.push(`%${escapeLike(String(req.query.q))}%`); where = `WHERE s.name ILIKE $1 OR s.code ILIKE $1 OR s.phone ILIKE $1`; }
  res.json((await db().query(
    `SELECT s.*, (${supplierDebtSql}) debt,
       coalesce((SELECT sum(total_amount) FROM stock_documents d WHERE d.supplier_id=s.id AND d.doc_type='import'),0) total_import,
       (SELECT count(*) FROM stock_documents d WHERE d.supplier_id=s.id AND d.doc_type='import') import_count
     FROM suppliers s ${where} ORDER BY s.name`, p)).rows);
});
router.get('/suppliers/export.xlsx', requirePerm('suppliers.view'), async (_req, res) => {
  const rows = (await db().query(`SELECT s.*, (${supplierDebtSql}) debt FROM suppliers s ORDER BY s.code`)).rows;
  await sendExcel(res, 'nha-cung-cap.xlsx', 'Nhà cung cấp', [
    { header: 'Mã', key: 'code' }, { header: 'Tên', key: 'name', width: 30 }, { header: 'Người liên hệ', key: 'contact_name', width: 20 },
    { header: 'Điện thoại', key: 'phone', width: 15 }, { header: 'Email', key: 'email', width: 24 }, { header: 'Địa chỉ', key: 'address', width: 36 },
    { header: 'Mã số thuế', key: 'tax_code' }, { header: 'Nợ đầu kỳ', key: 'opening_debt', money: true }, { header: 'Công nợ hiện tại', key: 'debt', money: true },
    { header: 'Ghi chú', key: 'note', width: 30 },
  ], rows);
});
router.post('/suppliers/import', requirePerm('suppliers.edit'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Chọn file Excel');
  const rows = await readExcel(req.file.buffer);
  let created = 0, updated = 0;
  const errors: string[] = [];
  await db().tx(async (q) => {
    for (const [i, r] of rows.entries()) {
      const name = String(r['Tên'] ?? '').trim();
      if (!name) { errors.push(`Dòng ${i + 2}: thiếu tên`); continue; }
      const code = String(r['Mã'] ?? '').trim() || (await nextCode(q, 'NCC', 4));
      const vals = [code, name, r['Người liên hệ'] ?? null, r['Điện thoại'] ? String(r['Điện thoại']) : null, r['Email'] ?? null, r['Địa chỉ'] ?? null, r['Mã số thuế'] ? String(r['Mã số thuế']) : null, Number(r['Nợ đầu kỳ'] ?? 0) || 0, r['Ghi chú'] ?? null];
      const ex = await q.query(`SELECT id FROM suppliers WHERE code=$1`, [code]);
      if (ex.rows[0]) {
        await q.query(`UPDATE suppliers SET name=$2, contact_name=$3, phone=$4, email=$5, address=$6, tax_code=$7, opening_debt=$8, note=$9 WHERE code=$1`, vals);
        updated++;
      } else {
        await q.query(`INSERT INTO suppliers(code, name, contact_name, phone, email, address, tax_code, opening_debt, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, vals);
        created++;
      }
    }
  });
  await audit(req, 'import', 'supplier', null, `Import nhà cung cấp: ${created} mới, ${updated} cập nhật`);
  res.json({ created, updated, errors });
});
router.get('/suppliers/:id', requirePerm('suppliers.view'), async (req, res) => {
  const s = (await db().query(`SELECT s.*, (${supplierDebtSql}) debt FROM suppliers s WHERE id=$1`, [req.params.id])).rows[0];
  if (!s) throw notFound();
  const imports = (await db().query(`SELECT d.*, w.name warehouse_name, u.full_name created_by_name FROM stock_documents d JOIN warehouses w ON w.id=d.warehouse_id LEFT JOIN users u ON u.id=d.created_by WHERE d.supplier_id=$1 ORDER BY d.created_at DESC LIMIT 200`, [s.id])).rows;
  const payments = (await db().query(`SELECT c.*, u.full_name created_by_name FROM cash_transactions c LEFT JOIN users u ON u.id=c.created_by WHERE c.supplier_id=$1 ORDER BY c.created_at DESC LIMIT 200`, [s.id])).rows;
  res.json({ ...s, imports, payments });
});
const supplierSchema = z.object({
  code: z.string().trim().max(30).optional().nullable(), name: z.string().trim().min(1, 'Nhập tên nhà cung cấp'),
  contact_name: zOptStr, phone: zOptStr, email: z.string().trim().email('Email không hợp lệ').optional().nullable().or(z.literal('')).transform((v) => v || null),
  address: zOptStr, tax_code: zOptStr, opening_debt: z.coerce.number().int().default(0), note: zOptStr, is_active: z.boolean().default(true),
});
router.post('/suppliers', requirePerm('suppliers.edit'), async (req, res) => {
  const b = supplierSchema.parse(req.body);
  const r = await db().tx(async (q) => {
    const code = b.code || (await nextCode(q, 'NCC', 4));
    return q.query(`INSERT INTO suppliers(code, name, contact_name, phone, email, address, tax_code, opening_debt, note, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [code, b.name, b.contact_name, b.phone, b.email, b.address, b.tax_code, b.opening_debt, b.note, b.is_active]);
  });
  await audit(req, 'create', 'supplier', r.rows[0].id, `Thêm NCC ${b.name}`);
  res.json(r.rows[0]);
});
router.put('/suppliers/:id', requirePerm('suppliers.edit'), async (req, res) => {
  const b = supplierSchema.parse(req.body);
  const r = await db().query(`UPDATE suppliers SET code=coalesce($2,code), name=$3, contact_name=$4, phone=$5, email=$6, address=$7, tax_code=$8, opening_debt=$9, note=$10, is_active=$11 WHERE id=$1 RETURNING *`,
    [req.params.id, b.code || null, b.name, b.contact_name, b.phone, b.email, b.address, b.tax_code, b.opening_debt, b.note, b.is_active]);
  if (!r.rows[0]) throw notFound();
  await audit(req, 'update', 'supplier', req.params.id as string, `Sửa NCC ${b.name}`);
  res.json(r.rows[0]);
});
router.delete('/suppliers/:id', requirePerm('suppliers.edit'), async (req, res) => {
  const used = (await db().query(`SELECT (SELECT count(*) FROM stock_documents WHERE supplier_id=$1) + (SELECT count(*) FROM cash_transactions WHERE supplier_id=$1) c`, [req.params.id])).rows[0].c;
  if (used > 0) throw badRequest('Nhà cung cấp đã có giao dịch – hãy chuyển sang "Ngừng giao dịch" thay vì xóa');
  await db().query(`DELETE FROM suppliers WHERE id=$1`, [req.params.id]);
  await audit(req, 'delete', 'supplier', req.params.id as string, 'Xóa nhà cung cấp');
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Khách hàng
export const customerDebtSql = `
  c.opening_debt
  + coalesce((SELECT sum(greatest(o.total - o.refunded_amount - o.paid_amount, 0)) FROM orders o WHERE o.customer_id=c.id AND o.status <> 'cancelled'),0)
  - coalesce((SELECT sum(amount) FROM cash_transactions t WHERE t.customer_id=c.id AND t.tx_type='receipt' AND t.category='customer_debt'),0)`;
const customerStatsSql = `
  coalesce((SELECT sum(o.total - o.refunded_amount) FROM orders o WHERE o.customer_id=c.id AND o.status <> 'cancelled'),0) total_spent,
  (SELECT count(*) FROM orders o WHERE o.customer_id=c.id AND o.status <> 'cancelled') order_count,
  (SELECT max(created_at) FROM orders o WHERE o.customer_id=c.id AND o.status <> 'cancelled') last_order_at`;

router.get('/customers', requirePerm('customers.view', 'pos.sell'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const cond: string[] = [];
  const p: any[] = [];
  if (req.query.q) { p.push(`%${escapeLike(String(req.query.q))}%`); cond.push(`(c.name ILIKE $${p.length} OR c.phone ILIKE $${p.length} OR c.code ILIKE $${p.length} OR c.email ILIKE $${p.length})`); }
  if (req.query.group) { p.push(req.query.group); cond.push(`c.customer_group=$${p.length}`); }
  if (req.query.birthday_month) { p.push(Number(req.query.birthday_month)); cond.push(`extract(month from c.birthday)=$${p.length}`); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = (await db().query(`SELECT count(*) c FROM customers c ${where}`, p)).rows[0].c;
  const sort = req.query.sort === 'spent' ? 'total_spent DESC' : 'c.id DESC';
  p.push(pageSize, offset);
  const rows = (await db().query(`SELECT c.*, ${customerStatsSql}, (${customerDebtSql}) debt FROM customers c ${where} ORDER BY ${sort} LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  res.json({ rows, total });
});
router.get('/customers/export.xlsx', requirePerm('customers.view'), async (_req, res) => {
  const rows = (await db().query(`SELECT c.*, ${customerStatsSql}, (${customerDebtSql}) debt FROM customers c ORDER BY c.code`)).rows;
  const g: Record<string, string> = { normal: 'Thường', silver: 'Bạc', gold: 'Vàng', vip: 'VIP' };
  await sendExcel(res, 'khach-hang.xlsx', 'Khách hàng', [
    { header: 'Mã', key: 'code' }, { header: 'Họ tên', key: 'name', width: 26 }, { header: 'Điện thoại', key: 'phone', width: 14 },
    { header: 'Email', key: 'email', width: 24 }, { header: 'Địa chỉ', key: 'address', width: 34 }, { header: 'Ngày sinh', key: 'birthday' },
    { header: 'Nhóm', key: 'group' }, { header: 'Số đơn', key: 'order_count' }, { header: 'Tổng chi tiêu', key: 'total_spent', money: true },
    { header: 'Công nợ', key: 'debt', money: true }, { header: 'Sở thích', key: 'preferences', width: 30 }, { header: 'Ghi chú', key: 'note', width: 30 },
  ], rows.map((r: any) => ({ ...r, group: g[r.customer_group] })));
});
router.get('/customers/:id', requirePerm('customers.view', 'pos.sell'), async (req, res) => {
  const c = (await db().query(`SELECT c.*, ${customerStatsSql}, (${customerDebtSql}) debt FROM customers c WHERE id=$1`, [req.params.id])).rows[0];
  if (!c) throw notFound();
  const orders = (await db().query(`SELECT o.id, o.code, o.total, o.paid_amount, o.refunded_amount, o.status, o.created_at,
      (SELECT string_agg(product_name, ', ') FROM order_items i WHERE i.order_id=o.id) items
      FROM orders o WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 200`, [c.id])).rows;
  const care = (await db().query(`SELECT l.*, u.full_name user_name FROM customer_care_logs l LEFT JOIN users u ON u.id=l.user_id WHERE customer_id=$1 ORDER BY created_at DESC`, [c.id])).rows;
  const warranties = (await db().query(`SELECT * FROM warranties WHERE customer_id=$1 ORDER BY start_date DESC`, [c.id])).rows;
  const repairs = (await db().query(`SELECT id, code, watch_brand, watch_model, serial_number, status, received_at FROM repair_tickets WHERE customer_id=$1 ORDER BY received_at DESC`, [c.id])).rows;
  const payments = (await db().query(`SELECT * FROM cash_transactions WHERE customer_id=$1 AND category='customer_debt' ORDER BY created_at DESC`, [c.id])).rows;
  res.json({ ...c, orders, care, warranties, repairs, payments });
});
const customerSchema = z.object({
  name: z.string().trim().min(1, 'Nhập họ tên khách hàng'),
  phone: z.string().trim().regex(/^[0-9+\s.-]{8,15}$/, 'Số điện thoại không hợp lệ').optional().nullable().or(z.literal('')).transform((v) => (v ? v.replace(/[\s.-]/g, '') : null)),
  email: z.string().trim().email('Email không hợp lệ').optional().nullable().or(z.literal('')).transform((v) => v || null),
  address: zOptStr, birthday: zOptDate, gender: z.enum(['male', 'female', 'other']).optional().nullable().or(z.literal('')).transform((v) => v || null),
  customer_group: z.enum(['normal', 'silver', 'gold', 'vip']).default('normal'),
  preferences: zOptStr, note: zOptStr, opening_debt: z.coerce.number().int().default(0),
});
router.post('/customers', requirePerm('customers.edit', 'pos.sell'), async (req, res) => {
  const b = customerSchema.parse(req.body);
  const r = await db().tx(async (q) => {
    const code = await nextCode(q, 'KH', 5);
    return q.query(`INSERT INTO customers(code, name, phone, email, address, birthday, gender, customer_group, preferences, note, opening_debt, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [code, b.name, b.phone, b.email, b.address, b.birthday, b.gender, b.customer_group, b.preferences, b.note, b.opening_debt, req.user!.id]);
  });
  await audit(req, 'create', 'customer', r.rows[0].id, `Thêm khách hàng ${b.name} ${b.phone ?? ''}`);
  res.json(r.rows[0]);
});
router.put('/customers/:id', requirePerm('customers.edit'), async (req, res) => {
  const b = customerSchema.parse(req.body);
  const r = await db().query(`UPDATE customers SET name=$2, phone=$3, email=$4, address=$5, birthday=$6, gender=$7, customer_group=$8, preferences=$9, note=$10, opening_debt=$11, updated_at=now() WHERE id=$1 RETURNING *`,
    [req.params.id, b.name, b.phone, b.email, b.address, b.birthday, b.gender, b.customer_group, b.preferences, b.note, b.opening_debt]);
  if (!r.rows[0]) throw notFound();
  await audit(req, 'update', 'customer', req.params.id as string, `Sửa khách hàng ${b.name}`);
  res.json(r.rows[0]);
});
router.delete('/customers/:id', requirePerm('customers.edit'), async (req, res) => {
  const used = (await db().query(`SELECT (SELECT count(*) FROM orders WHERE customer_id=$1)+(SELECT count(*) FROM repair_tickets WHERE customer_id=$1) c`, [req.params.id])).rows[0].c;
  if (used > 0) throw badRequest('Khách hàng đã có đơn hàng/phiếu sửa chữa, không thể xóa (dữ liệu lịch sử cần được giữ lại)');
  await db().query(`DELETE FROM customers WHERE id=$1`, [req.params.id]);
  await audit(req, 'delete', 'customer', req.params.id as string, 'Xóa khách hàng');
  res.json({ ok: true });
});
router.post('/customers/:id/care', requirePerm('customers.edit'), async (req, res) => {
  const b = z.object({ care_type: z.enum(['call', 'sms', 'zalo', 'visit', 'email', 'other']).default('call'), content: z.string().trim().min(1, 'Nhập nội dung chăm sóc'), next_care_date: zOptDate }).parse(req.body);
  const r = await db().query(`INSERT INTO customer_care_logs(customer_id, care_type, content, next_care_date, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id, b.care_type, b.content, b.next_care_date, req.user!.id]);
  await audit(req, 'create', 'customer_care', r.rows[0].id, `Ghi nhận chăm sóc KH #${req.params.id}`);
  res.json(r.rows[0]);
});
router.delete('/customers/:id/care/:logId', requirePerm('customers.edit'), async (req, res) => {
  await db().query(`DELETE FROM customer_care_logs WHERE id=$1 AND customer_id=$2`, [req.params.logId, req.params.id]);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Khuyến mãi
router.get('/promotions', async (_req, res) => {
  res.json((await db().query(`SELECT * FROM promotions ORDER BY is_active DESC, id DESC`)).rows);
});
const promoSchema = z.object({
  code: z.string().trim().min(2, 'Nhập mã').max(30).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, 'Nhập tên chương trình'),
  discount_type: z.enum(['percent', 'amount']),
  discount_value: z.coerce.number().int().positive('Giá trị giảm phải > 0'),
  max_discount: z.coerce.number().int().positive().optional().nullable().or(z.literal('')).transform((v) => v || null),
  min_order: z.coerce.number().int().min(0).default(0),
  start_date: zOptDate, end_date: zOptDate,
  usage_limit: z.coerce.number().int().positive().optional().nullable().or(z.literal('')).transform((v) => v || null),
  is_active: z.boolean().default(true),
}).refine((v) => v.discount_type !== 'percent' || v.discount_value <= 100, { message: 'Giảm tối đa 100%', path: ['discount_value'] });
router.post('/promotions', requirePerm('promotions.edit'), async (req, res) => {
  const b = promoSchema.parse(req.body);
  const r = await db().query(`INSERT INTO promotions(code, name, discount_type, discount_value, max_discount, min_order, start_date, end_date, usage_limit, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.code, b.name, b.discount_type, b.discount_value, b.max_discount, b.min_order, b.start_date, b.end_date, b.usage_limit, b.is_active]);
  await audit(req, 'create', 'promotion', r.rows[0].id, `Tạo khuyến mãi ${b.code}`);
  res.json(r.rows[0]);
});
router.put('/promotions/:id', requirePerm('promotions.edit'), async (req, res) => {
  const b = promoSchema.parse(req.body);
  const r = await db().query(`UPDATE promotions SET code=$2, name=$3, discount_type=$4, discount_value=$5, max_discount=$6, min_order=$7, start_date=$8, end_date=$9, usage_limit=$10, is_active=$11 WHERE id=$1 RETURNING *`,
    [req.params.id, b.code, b.name, b.discount_type, b.discount_value, b.max_discount, b.min_order, b.start_date, b.end_date, b.usage_limit, b.is_active]);
  if (!r.rows[0]) throw notFound();
  await audit(req, 'update', 'promotion', req.params.id as string, `Sửa khuyến mãi ${b.code}`);
  res.json(r.rows[0]);
});
router.delete('/promotions/:id', requirePerm('promotions.edit'), async (req, res) => {
  const used = (await db().query(`SELECT count(*) c FROM orders WHERE promotion_id=$1`, [req.params.id])).rows[0].c;
  if (used > 0) {
    await db().query(`UPDATE promotions SET is_active=false WHERE id=$1`, [req.params.id]);
    return res.json({ ok: true, message: 'Mã đã được dùng trong đơn hàng nên chỉ được ngừng áp dụng' });
  }
  await db().query(`DELETE FROM promotions WHERE id=$1`, [req.params.id]);
  await audit(req, 'delete', 'promotion', req.params.id as string, 'Xóa khuyến mãi');
  res.json({ ok: true });
});

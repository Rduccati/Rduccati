import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db, nextCode, type Queryable } from '../db.ts';
import { audit, badRequest, hasPerm, notFound, paging, requirePerm, zOptStr, escapeLike, getSetting } from '../core.ts';
import { sendExcel, readExcel } from '../excel.ts';
import { createStockDocument } from '../services/inventory.ts';

export const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const MOVEMENT_LABEL: Record<string, string> = {
  automatic: 'Automatic', quartz: 'Quartz', mechanical: 'Mechanical (lên cót tay)', solar: 'Solar', kinetic: 'Kinetic', spring_drive: 'Spring Drive', smart: 'Smartwatch',
};
const CONDITION_LABEL: Record<string, string> = { new: 'Mới', used: 'Đã qua sử dụng', repaired: 'Đã sửa chữa' };

// ------------------------------------------------------------------ Sinh mã
export function ean13CheckDigit(d12: string) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}
function brandAbbr(name?: string | null) {
  const s = (name || 'WP').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (s.slice(0, 3) || 'WP').padEnd(3, 'X');
}
export async function generateSku(q: Queryable, brandId?: number | null) {
  const b = brandId ? (await q.query(`SELECT name FROM brands WHERE id=$1`, [brandId])).rows[0] : null;
  const cfg = await getSetting<any>('barcode', {}, q);
  const prefix = (cfg.sku_prefix || '') + brandAbbr(b?.name) + '-';
  for (let i = 0; i < 50; i++) {
    const sku = await nextCode(q, prefix, 4);
    const ex = await q.query(`SELECT 1 FROM products WHERE sku=$1`, [sku]);
    if (!ex.rows.length) return sku;
  }
  throw badRequest('Không sinh được SKU');
}
export async function generateBarcode(q: Queryable, type?: string) {
  const cfg = await getSetting<any>('barcode', {}, q);
  const t = type || cfg.type || 'EAN13';
  for (let i = 0; i < 50; i++) {
    let code: string;
    if (t === 'EAN13') {
      const prefix = String(cfg.ean_prefix || '20').replace(/\D/g, '').slice(0, 3) || '20';
      const seq = (await nextCode(q, 'EAN:', 0)).slice(4);
      const d12 = (prefix + seq.padStart(12 - prefix.length, '0')).slice(0, 12);
      code = d12 + ean13CheckDigit(d12);
    } else {
      const prefix = cfg.code128_prefix || 'WP';
      code = await nextCode(q, prefix, 8);
    }
    const ex = await q.query(`SELECT 1 FROM products WHERE barcode=$1`, [code]);
    if (!ex.rows.length) return { code, type: t };
  }
  throw badRequest('Không sinh được barcode');
}

function validateBarcode(code: string, type: string) {
  if (type === 'EAN13') {
    if (!/^\d{13}$/.test(code)) throw badRequest('Barcode EAN-13 phải gồm đúng 13 chữ số');
    if (ean13CheckDigit(code.slice(0, 12)) !== code[12]) throw badRequest('Barcode EAN-13 sai số kiểm tra (check digit)');
  } else if (!/^[\x20-\x7E]{1,48}$/.test(code)) throw badRequest('Barcode Code 128 chỉ gồm ký tự ASCII, tối đa 48 ký tự');
}

/** Ẩn giá nhập / giá vốn với người không có quyền */
export function sanitizeProduct(req: Request, p: any) {
  if (!p || hasPerm(req.user, 'products.cost')) return p;
  const { purchase_price, cost_price, ...rest } = p;
  return rest;
}

const stockSub = `coalesce((SELECT sum(quantity) FROM stock_levels s WHERE s.product_id=p.id),0)`;

// ------------------------------------------------------------------ Danh sách
router.get('/products', requirePerm('products.view', 'pos.sell', 'inventory.view'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const cond: string[] = [];
  const p: any[] = [];
  const qs = req.query as Record<string, string>;
  if (qs.q) {
    p.push(`%${escapeLike(qs.q.trim())}%`);
    const i = p.length;
    cond.push(`(p.name ILIKE $${i} OR p.sku ILIKE $${i} OR p.barcode ILIKE $${i} OR p.model ILIKE $${i} OR p.reference_number ILIKE $${i}
      OR EXISTS (SELECT 1 FROM product_serials ps WHERE ps.product_id=p.id AND (ps.serial_number ILIKE $${i} OR ps.movement_number ILIKE $${i})))`);
  }
  if (qs.brand_id) { p.push(qs.brand_id); cond.push(`p.brand_id=$${p.length}`); }
  if (qs.condition) { p.push(qs.condition); cond.push(`p.condition=$${p.length}`); }
  if (qs.movement_type) { p.push(qs.movement_type); cond.push(`p.movement_type=$${p.length}`); }
  if (qs.supplier_id) { p.push(qs.supplier_id); cond.push(`p.supplier_id=$${p.length}`); }
  if (qs.min_price) { p.push(qs.min_price); cond.push(`p.sale_price >= $${p.length}`); }
  if (qs.max_price) { p.push(qs.max_price); cond.push(`p.sale_price <= $${p.length}`); }
  if (qs.active === '1') cond.push(`p.is_active`);
  if (qs.active === '0') cond.push(`NOT p.is_active`);
  if (qs.stock === 'in') cond.push(`${stockSub} > 0`);
  if (qs.stock === 'out') cond.push(`${stockSub} = 0`);
  if (qs.stock === 'low') cond.push(`${stockSub} <= p.min_stock AND p.is_active`);
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const sorts: Record<string, string> = {
    newest: 'p.id DESC', name: 'p.name ASC', price_asc: 'p.sale_price ASC', price_desc: 'p.sale_price DESC', stock: 'stock_qty DESC',
  };
  const order = sorts[qs.sort] || 'p.id DESC';
  const total = (await db().query(`SELECT count(*) c FROM products p ${where}`, p)).rows[0].c;
  p.push(pageSize, offset);
  const rows = (await db().query(
    `SELECT p.*, b.name brand_name, sp.name supplier_name, ${stockSub} stock_qty,
       (SELECT count(*) FROM product_serials ps WHERE ps.product_id=p.id AND ps.status='repairing') repairing_qty
       FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN suppliers sp ON sp.id=p.supplier_id
       ${where} ORDER BY ${order} LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  res.json({ rows: rows.map((r: any) => sanitizeProduct(req, r)), total });
});

router.get('/products/generate-codes', requirePerm('products.edit'), async (req, res) => {
  const out = await db().tx(async (q) => {
    const sku = await generateSku(q, req.query.brand_id ? Number(req.query.brand_id) : null);
    const bc = await generateBarcode(q, req.query.type as string | undefined);
    return { sku, barcode: bc.code, barcode_type: bc.type };
  });
  res.json(out);
});

// ------------------------------------------------------------------ Excel
const EXCEL_COLS = [
  { header: 'SKU', key: 'sku', width: 14 }, { header: 'Barcode', key: 'barcode', width: 16 }, { header: 'Loại barcode', key: 'barcode_type' },
  { header: 'Tên đồng hồ', key: 'name', width: 36 }, { header: 'Thương hiệu', key: 'brand_name', width: 16 }, { header: 'Model', key: 'model', width: 16 },
  { header: 'Reference', key: 'reference_number', width: 16 }, { header: 'Bộ máy', key: 'movement_label', width: 14 },
  { header: 'Đường kính (mm)', key: 'case_diameter' }, { header: 'Chất liệu vỏ', key: 'case_material', width: 18 }, { header: 'Chất liệu dây', key: 'strap_material', width: 18 },
  { header: 'Tình trạng', key: 'condition_label', width: 16 }, { header: 'Giá nhập', key: 'purchase_price', money: true }, { header: 'Giá vốn', key: 'cost_price', money: true },
  { header: 'Giá bán', key: 'sale_price', money: true }, { header: 'Giá khuyến mãi', key: 'promo_price', money: true }, { header: 'Bảo hành (tháng)', key: 'warranty_months' },
  { header: 'Nhà cung cấp', key: 'supplier_name', width: 20 }, { header: 'Quản lý serial', key: 'track_serial_label' }, { header: 'Tồn kho', key: 'stock_qty' },
  { header: 'Mô tả', key: 'description', width: 40 },
];
router.get('/products/export.xlsx', requirePerm('products.view'), async (req, res) => {
  const rows = (await db().query(`SELECT p.*, b.name brand_name, sp.name supplier_name, ${stockSub} stock_qty FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN suppliers sp ON sp.id=p.supplier_id ORDER BY p.sku`)).rows;
  const showCost = hasPerm(req.user, 'products.cost');
  const cols = EXCEL_COLS.filter((c) => showCost || !['purchase_price', 'cost_price'].includes(c.key));
  await sendExcel(res, 'san-pham.xlsx', 'Sản phẩm', cols, rows.map((r: any) => ({
    ...r, movement_label: MOVEMENT_LABEL[r.movement_type] ?? '', condition_label: CONDITION_LABEL[r.condition], track_serial_label: r.track_serial ? 'Có' : 'Không',
  })));
  await audit(req, 'export', 'product', null, `Xuất Excel ${rows.length} sản phẩm`);
});
router.get('/products/import-template.xlsx', requirePerm('products.edit'), async (_req, res) => {
  const cols = [...EXCEL_COLS.filter((c) => c.key !== 'stock_qty'), { header: 'Kho nhập', key: 'wh', width: 12 }, { header: 'Serial (phân cách dấu phẩy)', key: 'serials', width: 30 }, { header: 'Số lượng nhập', key: 'qty' }];
  await sendExcel(res, 'mau-import-san-pham.xlsx', 'Sản phẩm', cols, [{
    sku: '', barcode: '', barcode_type: 'EAN13', name: 'Seiko Presage Cocktail Time', brand_name: 'Seiko', model: 'Presage', reference_number: 'SRPB43J1',
    movement_label: 'Automatic', case_diameter: 40.5, case_material: 'Thép không gỉ', strap_material: 'Da bò', condition_label: 'Mới',
    purchase_price: 9000000, cost_price: 9000000, sale_price: 12500000, promo_price: null, warranty_months: 24, supplier_name: '', track_serial_label: 'Có',
    description: 'Để trống SKU/Barcode để hệ thống tự sinh. Cột Kho nhập (mã kho) + Serial sẽ tạo phiếu nhập tồn đầu.', wh: 'KHO01', serials: 'SN0001, SN0002', qty: '',
  }]);
});
router.post('/products/import', requirePerm('products.edit'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Chọn file Excel (.xlsx)');
  const rows = await readExcel(req.file.buffer);
  if (!rows.length) throw badRequest('File không có dữ liệu');
  const revMove = Object.fromEntries(Object.entries(MOVEMENT_LABEL).map(([k, v]) => [v.toLowerCase(), k]));
  const revCond: Record<string, string> = { 'mới': 'new', 'đã qua sử dụng': 'used', 'đã sửa chữa': 'repaired', new: 'new', used: 'used', repaired: 'repaired' };
  let created = 0, updated = 0, stocked = 0;
  const errors: string[] = [];
  const uid = req.user!.id;
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    try {
      await db().tx(async (q) => {
        const name = String(r['Tên đồng hồ'] ?? '').trim();
        if (!name) throw badRequest('thiếu tên đồng hồ');
        let brandId: number | null = null;
        const bn = String(r['Thương hiệu'] ?? '').trim();
        if (bn) {
          const b = (await q.query(`SELECT id FROM brands WHERE lower(name)=lower($1)`, [bn])).rows[0] ?? (await q.query(`INSERT INTO brands(name) VALUES ($1) RETURNING id`, [bn])).rows[0];
          brandId = b.id;
        }
        let supplierId: number | null = null;
        const sn = String(r['Nhà cung cấp'] ?? '').trim();
        if (sn) supplierId = (await q.query(`SELECT id FROM suppliers WHERE lower(name)=lower($1) OR lower(code)=lower($1)`, [sn])).rows[0]?.id ?? null;
        const num = (k: string) => { const v = r[k]; if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/[,\s]/g, '')); if (!Number.isFinite(n) || n < 0) throw badRequest(`cột "${k}" không hợp lệ`); return Math.round(n); };
        const mv = String(r['Bộ máy'] ?? '').trim().toLowerCase();
        const movement = mv ? (revMove[mv] ?? (Object.keys(MOVEMENT_LABEL).includes(mv) ? mv : null)) : null;
        if (mv && !movement) throw badRequest(`bộ máy "${r['Bộ máy']}" không hợp lệ`);
        const cond = revCond[String(r['Tình trạng'] ?? 'Mới').trim().toLowerCase()] ?? 'new';
        const track = !['không', 'khong', 'no', '0', 'false'].includes(String(r['Quản lý serial'] ?? 'Có').trim().toLowerCase());
        let sku = String(r['SKU'] ?? '').trim();
        const existing = sku ? (await q.query(`SELECT * FROM products WHERE sku=$1`, [sku])).rows[0] : null;
        const bType = String(r['Loại barcode'] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') === 'CODE128' ? 'CODE128' : 'EAN13';
        let barcode = String(r['Barcode'] ?? '').trim();
        const vals = {
          name, brand_id: brandId, model: r['Model'] ?? null, reference_number: r['Reference'] ? String(r['Reference']) : null, movement_type: movement,
          case_diameter: r['Đường kính (mm)'] ? Number(r['Đường kính (mm)']) : null, case_material: r['Chất liệu vỏ'] ?? null, strap_material: r['Chất liệu dây'] ?? null,
          condition: cond, purchase_price: num('Giá nhập') ?? 0, cost_price: num('Giá vốn') ?? num('Giá nhập') ?? 0, sale_price: num('Giá bán') ?? 0,
          promo_price: num('Giá khuyến mãi'), warranty_months: num('Bảo hành (tháng)') ?? 12, supplier_id: supplierId, description: r['Mô tả'] ?? null, track_serial: track,
        };
        let productId: number;
        if (existing) {
          await q.query(`UPDATE products SET name=$2, brand_id=$3, model=$4, reference_number=$5, movement_type=$6, case_diameter=$7, case_material=$8, strap_material=$9,
              condition=$10, sale_price=$11, promo_price=$12, warranty_months=$13, supplier_id=$14, description=$15, updated_by=$16, updated_at=now() WHERE id=$1`,
            [existing.id, vals.name, vals.brand_id, vals.model, vals.reference_number, vals.movement_type, vals.case_diameter, vals.case_material, vals.strap_material,
             vals.condition, vals.sale_price, vals.promo_price, vals.warranty_months, vals.supplier_id, vals.description, uid]);
          if (Number(existing.sale_price) !== vals.sale_price) await q.query(`INSERT INTO product_price_history(product_id, field, old_value, new_value, user_id, reason) VALUES ($1,'sale_price',$2,$3,$4,'Import Excel')`, [existing.id, existing.sale_price, vals.sale_price, uid]);
          productId = existing.id;
          updated++;
        } else {
          if (!sku) sku = await generateSku(q, brandId);
          if (barcode) validateBarcode(barcode, bType); else barcode = (await generateBarcode(q, bType)).code;
          const ins = await q.query(`INSERT INTO products(sku, barcode, barcode_type, name, brand_id, model, reference_number, movement_type, case_diameter, case_material, strap_material,
              condition, purchase_price, cost_price, sale_price, promo_price, warranty_months, supplier_id, description, track_serial, created_by, updated_by)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21) RETURNING id`,
            [sku, barcode, bType, vals.name, vals.brand_id, vals.model, vals.reference_number, vals.movement_type, vals.case_diameter, vals.case_material, vals.strap_material,
             vals.condition, vals.purchase_price, vals.cost_price, vals.sale_price, vals.promo_price, vals.warranty_months, vals.supplier_id, vals.description, vals.track_serial, uid]);
          productId = ins.rows[0].id;
          created++;
        }
        // Tồn đầu (tạo phiếu nhập để có lịch sử)
        const whCode = String(r['Kho nhập'] ?? '').trim();
        const serials = String(r['Serial (phân cách dấu phẩy)'] ?? '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
        const qty = num('Số lượng nhập') ?? 0;
        if (whCode && (serials.length || qty > 0)) {
          const wh = (await q.query(`SELECT id FROM warehouses WHERE lower(code)=lower($1) OR lower(name)=lower($1)`, [whCode])).rows[0];
          if (!wh) throw badRequest(`không tìm thấy kho "${whCode}"`);
          await createStockDocument(q, {
            doc_type: 'import', warehouse_id: wh.id, supplier_id: supplierId, note: `Nhập tồn từ Excel (dòng ${line})`, reason: null, paid_amount: 0, payment_method: 'cash',
            consignor_name: null, consignor_phone: null, to_warehouse_id: null,
            items: [{ product_id: productId, quantity: track ? serials.length : qty, unit_cost: vals.purchase_price, serials: track ? serials.map((s) => ({ serial_number: s, movement_number: null, note: null })) : [], serial_ids: [], note: null }],
          }, uid);
          stocked++;
        }
      });
    } catch (e: any) {
      errors.push(`Dòng ${line}: ${e.message}`);
    }
  }
  await audit(req, 'import', 'product', null, `Import Excel: ${created} mới, ${updated} cập nhật, ${stocked} phiếu nhập tồn, ${errors.length} lỗi`);
  res.json({ created, updated, stocked, errors });
});

// ------------------------------------------------------------------ Chi tiết
router.get('/products/:id', requirePerm('products.view', 'inventory.view', 'pos.sell'), async (req, res) => {
  const p = (await db().query(`SELECT p.*, b.name brand_name, sp.name supplier_name, ${stockSub} stock_qty,
      cu.full_name created_by_name, uu.full_name updated_by_name
      FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN suppliers sp ON sp.id=p.supplier_id
      LEFT JOIN users cu ON cu.id=p.created_by LEFT JOIN users uu ON uu.id=p.updated_by WHERE p.id=$1`, [req.params.id])).rows[0];
  if (!p) throw notFound('Sản phẩm không tồn tại');
  const showCost = hasPerm(req.user, 'products.cost');
  const serials = (await db().query(`SELECT ps.*, w.name warehouse_name, sp.name supplier_name,
      (SELECT o.code FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.serial_id=ps.id AND o.status<>'cancelled' ORDER BY o.id DESC LIMIT 1) order_code
      FROM product_serials ps LEFT JOIN warehouses w ON w.id=ps.warehouse_id LEFT JOIN suppliers sp ON sp.id=ps.supplier_id
      WHERE ps.product_id=$1 ORDER BY ps.status='in_stock' DESC, ps.received_at DESC`, [p.id])).rows
    .map((s: any) => (showCost ? s : { ...s, cost_price: undefined, consignment_price: undefined }));
  const stock = (await db().query(`SELECT s.*, w.name warehouse_name FROM stock_levels s JOIN warehouses w ON w.id=s.warehouse_id WHERE product_id=$1 ORDER BY w.id`, [p.id])).rows;
  const priceHistory = (await db().query(`SELECT h.*, u.full_name user_name FROM product_price_history h LEFT JOIN users u ON u.id=h.user_id WHERE product_id=$1 ${showCost ? '' : `AND field IN ('sale_price','promo_price')`} ORDER BY h.id DESC LIMIT 200`, [p.id])).rows;
  const movements = (await db().query(`SELECT m.*, w.name warehouse_name, u.full_name user_name, ps.serial_number FROM stock_movements m JOIN warehouses w ON w.id=m.warehouse_id
      LEFT JOIN users u ON u.id=m.created_by LEFT JOIN product_serials ps ON ps.id=m.serial_id WHERE m.product_id=$1 ORDER BY m.id DESC LIMIT 300`, [p.id])).rows
    .map((m: any) => (showCost ? m : { ...m, unit_cost: undefined }));
  res.json({ ...sanitizeProduct(req, p), serials, stock, price_history: priceHistory, movements });
});

// ------------------------------------------------------------------ Thêm / sửa
const productSchema = z.object({
  sku: z.string().trim().max(40).optional().nullable(),
  barcode: z.string().trim().max(48).optional().nullable(),
  barcode_type: z.enum(['CODE128', 'EAN13']).default('EAN13'),
  name: z.string().trim().min(2, 'Nhập tên đồng hồ').max(200),
  brand_id: z.coerce.number().int().positive().optional().nullable().or(z.literal('')).transform((v) => v || null),
  model: zOptStr, reference_number: zOptStr,
  movement_type: z.enum(['automatic', 'quartz', 'mechanical', 'solar', 'kinetic', 'spring_drive', 'smart']).optional().nullable().or(z.literal('')).transform((v) => v || null),
  case_diameter: z.coerce.number().min(0).max(100).optional().nullable().or(z.literal('')).transform((v) => (v === '' || v == null ? null : v)),
  case_material: zOptStr, strap_material: zOptStr, gender: zOptStr,
  condition: z.enum(['new', 'used', 'repaired']).default('new'),
  purchase_price: z.coerce.number().int().min(0).default(0),
  cost_price: z.coerce.number().int().min(0).default(0),
  sale_price: z.coerce.number().int().min(0, 'Giá bán không hợp lệ'),
  promo_price: z.coerce.number().int().min(0).optional().nullable().or(z.literal('')).transform((v) => (v === '' || v == null || v === 0 ? null : v)),
  warranty_months: z.coerce.number().int().min(0).max(240).default(12),
  supplier_id: z.coerce.number().int().positive().optional().nullable().or(z.literal('')).transform((v) => v || null),
  description: z.string().max(10000).optional().nullable(),
  images: z.array(z.string().max(500)).max(12).default([]),
  track_serial: z.boolean().default(true),
  min_stock: z.coerce.number().int().min(0).default(1),
  is_active: z.boolean().default(true),
  reason: zOptStr,
  opening_stock: z.object({
    warehouse_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(0).default(0),
    unit_cost: z.coerce.number().int().min(0).default(0),
    serials: z.array(z.object({ serial_number: z.string().trim().min(1), movement_number: zOptStr, note: zOptStr })).default([]),
  }).optional().nullable(),
}).refine((v) => v.promo_price == null || v.promo_price < v.sale_price, { message: 'Giá khuyến mãi phải nhỏ hơn giá bán', path: ['promo_price'] });

router.post('/products', requirePerm('products.edit'), async (req, res) => {
  const b = productSchema.parse(req.body);
  const uid = req.user!.id;
  const product = await db().tx(async (q) => {
    const sku = b.sku || (await generateSku(q, b.brand_id));
    let barcode = b.barcode;
    if (barcode) validateBarcode(barcode, b.barcode_type); else barcode = (await generateBarcode(q, b.barcode_type)).code;
    const r = await q.query(`INSERT INTO products(sku, barcode, barcode_type, name, brand_id, model, reference_number, movement_type, case_diameter, case_material,
        strap_material, gender, condition, purchase_price, cost_price, sale_price, promo_price, warranty_months, supplier_id, description, images, track_serial,
        min_stock, is_active, created_by, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25) RETURNING *`,
      [sku, barcode, b.barcode_type, b.name, b.brand_id, b.model, b.reference_number, b.movement_type, b.case_diameter, b.case_material, b.strap_material,
       b.gender, b.condition, b.purchase_price, b.cost_price || b.purchase_price, b.sale_price, b.promo_price, b.warranty_months, b.supplier_id, b.description,
       JSON.stringify(b.images), b.track_serial, b.min_stock, b.is_active, uid]);
    const p = r.rows[0];
    const os = b.opening_stock;
    if (os && (os.serials.length || os.quantity > 0)) {
      await createStockDocument(q, {
        doc_type: 'import', warehouse_id: os.warehouse_id, supplier_id: b.supplier_id, note: `Nhập tồn đầu khi tạo sản phẩm ${sku}`, reason: null,
        paid_amount: 0, payment_method: 'cash', consignor_name: null, consignor_phone: null, to_warehouse_id: null,
        items: [{ product_id: p.id, quantity: b.track_serial ? os.serials.length : os.quantity, unit_cost: os.unit_cost || b.purchase_price,
          serials: b.track_serial ? os.serials : [], serial_ids: [], note: null }],
      }, uid);
    }
    await audit(req, 'create', 'product', p.id, `Thêm sản phẩm ${sku} – ${b.name}`, undefined, q);
    return p;
  });
  res.json(product);
});

router.put('/products/:id', requirePerm('products.edit'), async (req, res) => {
  const b = productSchema.parse(req.body);
  const uid = req.user!.id;
  const canCost = hasPerm(req.user, 'products.cost');
  const out = await db().tx(async (q) => {
    const old = (await q.query(`SELECT * FROM products WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!old) throw notFound('Sản phẩm không tồn tại');
    const sku = b.sku || old.sku;
    const barcode = b.barcode || old.barcode;
    if (barcode !== old.barcode || b.barcode_type !== old.barcode_type) validateBarcode(barcode, b.barcode_type);
    if (old.track_serial !== b.track_serial) {
      const mv = (await q.query(`SELECT count(*) c FROM stock_movements WHERE product_id=$1`, [old.id])).rows[0].c;
      if (mv > 0) throw badRequest('Sản phẩm đã có giao dịch kho, không thể thay đổi chế độ quản lý serial');
    }
    const purchase = canCost ? b.purchase_price : Number(old.purchase_price);
    const cost = canCost ? b.cost_price : Number(old.cost_price);
    const changes: [string, any, any][] = [];
    for (const [f, nv] of [['purchase_price', purchase], ['cost_price', cost], ['sale_price', b.sale_price], ['promo_price', b.promo_price]] as const) {
      const ov = old[f] == null ? null : Number(old[f]);
      if (ov !== (nv == null ? null : Number(nv))) changes.push([f, ov, nv]);
    }
    for (const [f, ov, nv] of changes) {
      await q.query(`INSERT INTO product_price_history(product_id, field, old_value, new_value, user_id, reason) VALUES ($1,$2,$3,$4,$5,$6)`, [old.id, f, ov, nv, uid, b.reason || 'Cập nhật sản phẩm']);
    }
    const r = await q.query(`UPDATE products SET sku=$2, barcode=$3, barcode_type=$4, name=$5, brand_id=$6, model=$7, reference_number=$8, movement_type=$9, case_diameter=$10,
        case_material=$11, strap_material=$12, gender=$13, condition=$14, purchase_price=$15, cost_price=$16, sale_price=$17, promo_price=$18, warranty_months=$19,
        supplier_id=$20, description=$21, images=$22, track_serial=$23, min_stock=$24, is_active=$25, updated_by=$26, updated_at=now() WHERE id=$1 RETURNING *`,
      [old.id, sku, barcode, b.barcode_type, b.name, b.brand_id, b.model, b.reference_number, b.movement_type, b.case_diameter, b.case_material, b.strap_material,
       b.gender, b.condition, purchase, cost, b.sale_price, b.promo_price, b.warranty_months, b.supplier_id, b.description, JSON.stringify(b.images), b.track_serial,
       b.min_stock, b.is_active, uid]);
    await audit(req, 'update', 'product', old.id, `Sửa sản phẩm ${sku}`, changes.length ? { price_changes: changes } : undefined, q);
    return r.rows[0];
  });
  res.json(sanitizeProduct(req, out));
});

router.post('/products/:id/duplicate', requirePerm('products.edit'), async (req, res) => {
  const out = await db().tx(async (q) => {
    const p = (await q.query(`SELECT * FROM products WHERE id=$1`, [req.params.id])).rows[0];
    if (!p) throw notFound();
    const sku = await generateSku(q, p.brand_id);
    const bc = await generateBarcode(q, p.barcode_type);
    const r = await q.query(`INSERT INTO products(sku, barcode, barcode_type, name, brand_id, model, reference_number, movement_type, case_diameter, case_material,
        strap_material, gender, condition, purchase_price, cost_price, sale_price, promo_price, warranty_months, supplier_id, description, images, track_serial, min_stock, is_active, created_by, updated_by)
      SELECT $2,$3,barcode_type,name||' (bản sao)',brand_id,model,reference_number,movement_type,case_diameter,case_material,strap_material,gender,condition,purchase_price,
        purchase_price,sale_price,promo_price,warranty_months,supplier_id,description,images,track_serial,min_stock,true,$4,$4 FROM products WHERE id=$1 RETURNING *`,
      [p.id, sku, bc.code, req.user!.id]);
    await audit(req, 'create', 'product', r.rows[0].id, `Nhân bản sản phẩm ${p.sku} → ${sku}`, undefined, q);
    return r.rows[0];
  });
  res.json(out);
});

router.delete('/products/:id', requirePerm('products.delete'), async (req, res) => {
  const p = (await db().query(`SELECT * FROM products WHERE id=$1`, [req.params.id])).rows[0];
  if (!p) throw notFound();
  const used = (await db().query(`SELECT (SELECT count(*) FROM stock_movements WHERE product_id=$1) + (SELECT count(*) FROM order_items WHERE product_id=$1) c`, [p.id])).rows[0].c;
  if (used > 0) {
    await db().query(`UPDATE products SET is_active=false, updated_by=$2, updated_at=now() WHERE id=$1`, [p.id, req.user!.id]);
    await audit(req, 'update', 'product', p.id, `Ngừng kinh doanh ${p.sku} (đã có giao dịch nên không xóa)`);
    return res.json({ ok: true, deactivated: true, message: 'Sản phẩm đã có lịch sử giao dịch nên được chuyển sang "Ngừng kinh doanh" thay vì xóa' });
  }
  await db().tx(async (q) => {
    await q.query(`DELETE FROM product_price_history WHERE product_id=$1`, [p.id]);
    await q.query(`DELETE FROM products WHERE id=$1`, [p.id]);
  });
  await audit(req, 'delete', 'product', p.id, `Xóa sản phẩm ${p.sku} – ${p.name}`);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Serial
router.get('/serials', requirePerm('products.view', 'inventory.view', 'warranty.view'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const cond: string[] = [];
  const p: any[] = [];
  const qs = req.query as Record<string, string>;
  if (qs.q) { p.push(`%${escapeLike(qs.q)}%`); cond.push(`(ps.serial_number ILIKE $${p.length} OR ps.movement_number ILIKE $${p.length} OR pr.name ILIKE $${p.length} OR pr.sku ILIKE $${p.length})`); }
  if (qs.status) { p.push(qs.status); cond.push(`ps.status=$${p.length}`); }
  if (qs.product_id) { p.push(qs.product_id); cond.push(`ps.product_id=$${p.length}`); }
  if (qs.warehouse_id) { p.push(qs.warehouse_id); cond.push(`ps.warehouse_id=$${p.length}`); }
  if (qs.consignment === '1') cond.push(`ps.is_consignment`);
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = (await db().query(`SELECT count(*) c FROM product_serials ps JOIN products pr ON pr.id=ps.product_id ${where}`, p)).rows[0].c;
  p.push(pageSize, offset);
  const rows = (await db().query(`SELECT ps.*, pr.name product_name, pr.sku, pr.sale_price, pr.promo_price, b.name brand_name, w.name warehouse_name,
      (now()::date - ps.received_at::date) days_in_stock
      FROM product_serials ps JOIN products pr ON pr.id=ps.product_id LEFT JOIN brands b ON b.id=pr.brand_id LEFT JOIN warehouses w ON w.id=ps.warehouse_id
      ${where} ORDER BY ps.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  const showCost = hasPerm(req.user, 'products.cost');
  res.json({ rows: showCost ? rows : rows.map((r: any) => ({ ...r, cost_price: undefined, consignment_price: undefined })), total });
});
router.put('/serials/:id', requirePerm('products.edit', 'inventory.edit'), async (req, res) => {
  const b = z.object({ serial_number: z.string().trim().min(1, 'Serial không được trống'), movement_number: zOptStr, condition: z.enum(['new', 'used', 'repaired']), note: zOptStr }).parse(req.body);
  const old = (await db().query(`SELECT * FROM product_serials WHERE id=$1`, [req.params.id])).rows[0];
  if (!old) throw notFound();
  await db().query(`UPDATE product_serials SET serial_number=$2, movement_number=$3, condition=$4, note=$5 WHERE id=$1`, [old.id, b.serial_number, b.movement_number, b.condition, b.note]);
  await audit(req, 'update', 'serial', old.id, `Sửa serial ${old.serial_number}${old.serial_number !== b.serial_number ? ' → ' + b.serial_number : ''}`, { old, new: b });
  res.json({ ok: true });
});

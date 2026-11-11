import { Router } from 'express';
import { z } from 'zod';
import { db, nextCode } from '../db.ts';
import { audit, badRequest, hasPerm, notFound, paging, requirePerm, escapeLike, getSetting } from '../core.ts';
import { createStockDocument, stockDocSchema, DOC_LABEL } from '../services/inventory.ts';
import { sendExcel } from '../excel.ts';

export const router = Router();

router.get('/inventory/stock', requirePerm('inventory.view'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const qs = req.query as Record<string, string>;
  const cond: string[] = ['p.is_active'];
  const p: any[] = [];
  const whFilter = qs.warehouse_id ? (p.push(qs.warehouse_id), `AND s.warehouse_id=$${p.length}`) : '';
  if (qs.q) { p.push(`%${escapeLike(qs.q)}%`); cond.push(`(p.name ILIKE $${p.length} OR p.sku ILIKE $${p.length} OR p.barcode ILIKE $${p.length})`); }
  if (qs.brand_id) { p.push(qs.brand_id); cond.push(`p.brand_id=$${p.length}`); }
  const qty = `coalesce((SELECT sum(quantity) FROM stock_levels s WHERE s.product_id=p.id ${whFilter}),0)`;
  if (qs.filter === 'low') cond.push(`${qty} <= p.min_stock`);
  if (qs.filter === 'in') cond.push(`${qty} > 0`);
  const where = 'WHERE ' + cond.join(' AND ');
  const total = (await db().query(`SELECT count(*) c FROM products p ${where}`, p)).rows[0].c;
  const sums = (await db().query(`SELECT coalesce(sum(${qty}),0) qty, coalesce(sum(${qty} * p.cost_price),0) value, coalesce(sum(${qty} * p.sale_price),0) retail FROM products p ${where}`, p)).rows[0];
  p.push(pageSize, offset);
  const rows = (await db().query(`SELECT p.id, p.sku, p.barcode, p.name, p.track_serial, p.min_stock, p.cost_price, p.sale_price, b.name brand_name, ${qty} quantity,
      (SELECT count(*) FROM product_serials ps WHERE ps.product_id=p.id AND ps.status='repairing') repairing_qty,
      (SELECT count(*) FROM product_serials ps WHERE ps.product_id=p.id AND ps.status='in_stock' AND ps.is_consignment) consign_qty,
      (SELECT max(created_at) FROM stock_movements m WHERE m.product_id=p.id AND m.qty_change>0) last_in
      FROM products p LEFT JOIN brands b ON b.id=p.brand_id ${where} ORDER BY quantity DESC, p.name LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  const showCost = hasPerm(req.user, 'products.cost');
  res.json({ rows: showCost ? rows : rows.map((r: any) => ({ ...r, cost_price: undefined })), total, summary: showCost ? sums : { qty: sums.qty, retail: sums.retail } });
});

router.get('/inventory/alerts', requirePerm('inventory.view', 'dashboard.view'), async (_req, res) => {
  const cfg = await getSetting<any>('inventory', {});
  const agingDays = Number(cfg.aging_days) || 180;
  const low = (await db().query(`SELECT p.id, p.sku, p.name, p.min_stock, b.name brand_name, coalesce((SELECT sum(quantity) FROM stock_levels s WHERE s.product_id=p.id),0) quantity
      FROM products p LEFT JOIN brands b ON b.id=p.brand_id WHERE p.is_active AND coalesce((SELECT sum(quantity) FROM stock_levels s WHERE s.product_id=p.id),0) <= p.min_stock
      ORDER BY quantity, p.name LIMIT 200`)).rows;
  const aging = (await db().query(`SELECT ps.id serial_id, ps.serial_number, ps.received_at, ps.cost_price, ps.is_consignment, p.id product_id, p.sku, p.name, p.sale_price, b.name brand_name, w.name warehouse_name,
      (now()::date - ps.received_at::date) days_in_stock
      FROM product_serials ps JOIN products p ON p.id=ps.product_id LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN warehouses w ON w.id=ps.warehouse_id
      WHERE ps.status='in_stock' AND ps.received_at < now() - ($1 || ' days')::interval ORDER BY ps.received_at LIMIT 200`, [String(agingDays)])).rows;
  res.json({ aging_days: agingDays, low, aging });
});

router.get('/inventory/documents', requirePerm('inventory.view'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const qs = req.query as Record<string, string>;
  const cond: string[] = [];
  const p: any[] = [];
  if (qs.type) { p.push(qs.type); cond.push(`d.doc_type=$${p.length}`); }
  if (qs.warehouse_id) { p.push(qs.warehouse_id); cond.push(`(d.warehouse_id=$${p.length} OR d.to_warehouse_id=$${p.length})`); }
  if (qs.supplier_id) { p.push(qs.supplier_id); cond.push(`d.supplier_id=$${p.length}`); }
  if (qs.q) { p.push(`%${escapeLike(qs.q)}%`); cond.push(`(d.code ILIKE $${p.length} OR d.note ILIKE $${p.length})`); }
  if (qs.from) { p.push(qs.from); cond.push(`d.created_at >= $${p.length}::date`); }
  if (qs.to) { p.push(qs.to); cond.push(`d.created_at < $${p.length}::date + 1`); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = (await db().query(`SELECT count(*) c FROM stock_documents d ${where}`, p)).rows[0].c;
  p.push(pageSize, offset);
  const rows = (await db().query(`SELECT d.*, w.name warehouse_name, tw.name to_warehouse_name, s.name supplier_name, u.full_name created_by_name,
      (SELECT coalesce(sum(abs(quantity)),0) FROM stock_document_items i WHERE i.document_id=d.id) item_qty
      FROM stock_documents d JOIN warehouses w ON w.id=d.warehouse_id LEFT JOIN warehouses tw ON tw.id=d.to_warehouse_id
      LEFT JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN users u ON u.id=d.created_by ${where} ORDER BY d.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  res.json({ rows, total });
});

router.get('/inventory/documents/:id', requirePerm('inventory.view'), async (req, res) => {
  const d = (await db().query(`SELECT d.*, w.name warehouse_name, tw.name to_warehouse_name, s.name supplier_name, u.full_name created_by_name
      FROM stock_documents d JOIN warehouses w ON w.id=d.warehouse_id LEFT JOIN warehouses tw ON tw.id=d.to_warehouse_id
      LEFT JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN users u ON u.id=d.created_by WHERE d.id=$1`, [req.params.id])).rows[0];
  if (!d) throw notFound();
  const items = (await db().query(`SELECT i.*, p.sku, p.name product_name, ps.serial_number, ps.consignor_name FROM stock_document_items i JOIN products p ON p.id=i.product_id
      LEFT JOIN product_serials ps ON ps.id=i.serial_id WHERE i.document_id=$1 ORDER BY i.id`, [d.id])).rows;
  res.json({ ...d, type_label: DOC_LABEL[d.doc_type], items });
});

router.post('/inventory/documents', requirePerm('inventory.edit'), async (req, res) => {
  const b = stockDocSchema.parse(req.body);
  delete (b as any).created_at;
  const doc = await db().tx(async (q) => {
    const d = await createStockDocument(q, b, req.user!.id);
    await audit(req, 'create', 'stock_document', d.id, `${DOC_LABEL[d.doc_type]} ${d.code}`, { items: b.items.length, total: d.total_amount }, q);
    return d;
  });
  res.json(doc);
});

router.get('/inventory/movements', requirePerm('inventory.view'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const qs = req.query as Record<string, string>;
  const cond: string[] = [];
  const p: any[] = [];
  if (qs.product_id) { p.push(qs.product_id); cond.push(`m.product_id=$${p.length}`); }
  if (qs.warehouse_id) { p.push(qs.warehouse_id); cond.push(`m.warehouse_id=$${p.length}`); }
  if (qs.ref_type) { p.push(qs.ref_type); cond.push(`m.ref_type=$${p.length}`); }
  if (qs.q) { p.push(`%${escapeLike(qs.q)}%`); cond.push(`(pr.name ILIKE $${p.length} OR pr.sku ILIKE $${p.length} OR m.ref_code ILIKE $${p.length} OR ps.serial_number ILIKE $${p.length})`); }
  if (qs.from) { p.push(qs.from); cond.push(`m.created_at >= $${p.length}::date`); }
  if (qs.to) { p.push(qs.to); cond.push(`m.created_at < $${p.length}::date + 1`); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const base = `FROM stock_movements m JOIN products pr ON pr.id=m.product_id JOIN warehouses w ON w.id=m.warehouse_id
      LEFT JOIN product_serials ps ON ps.id=m.serial_id LEFT JOIN users u ON u.id=m.created_by ${where}`;
  const total = (await db().query(`SELECT count(*) c ${base}`, p)).rows[0].c;
  const cols = `m.*, pr.sku, pr.name product_name, w.name warehouse_name, ps.serial_number, u.full_name user_name`;
  if (qs.format === 'xlsx') {
    const rows = (await db().query(`SELECT ${cols} ${base} ORDER BY m.id DESC LIMIT 20000`, p)).rows;
    return sendExcel(res, 'lich-su-nhap-xuat.xlsx', 'Nhập xuất', [
      { header: 'Thời gian', key: 'time', width: 18 }, { header: 'Chứng từ', key: 'ref_code', width: 12 }, { header: 'Loại', key: 'ref_type', width: 14 },
      { header: 'SKU', key: 'sku', width: 12 }, { header: 'Sản phẩm', key: 'product_name', width: 32 }, { header: 'Serial', key: 'serial_number', width: 16 },
      { header: 'Kho', key: 'warehouse_name', width: 16 }, { header: 'Thay đổi', key: 'qty_change' }, { header: 'Tồn sau', key: 'balance_after' },
      { header: 'Người thực hiện', key: 'user_name', width: 18 }, { header: 'Ghi chú', key: 'note', width: 30 },
    ], rows.map((r: any) => ({ ...r, time: new Date(r.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) })));
  }
  p.push(pageSize, offset);
  const rows = (await db().query(`SELECT ${cols} ${base} ORDER BY m.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  res.json({ rows, total });
});

// ------------------------------------------------------------------ Ký gửi: thanh toán cho người ký gửi khi hàng đã bán
router.get('/inventory/consignments', requirePerm('inventory.view'), async (_req, res) => {
  const rows = (await db().query(`SELECT ps.*, p.name product_name, p.sku, w.name warehouse_name,
      (SELECT oi.unit_price - oi.discount FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.serial_id=ps.id AND o.status<>'cancelled' ORDER BY oi.id DESC LIMIT 1) sold_price,
      (SELECT o.code FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.serial_id=ps.id AND o.status<>'cancelled' ORDER BY oi.id DESC LIMIT 1) order_code
      FROM product_serials ps JOIN products p ON p.id=ps.product_id LEFT JOIN warehouses w ON w.id=ps.warehouse_id
      WHERE ps.is_consignment ORDER BY (ps.status='sold' AND ps.consignment_settled_at IS NULL) DESC, ps.id DESC`)).rows;
  res.json(rows);
});
router.post('/inventory/consignments/:serialId/settle', requirePerm('finance.edit'), async (req, res) => {
  const b = z.object({ method: z.enum(['cash', 'transfer']).default('cash') }).parse(req.body);
  const out = await db().tx(async (q) => {
    const s = (await q.query(`SELECT * FROM product_serials WHERE id=$1 FOR UPDATE`, [req.params.serialId])).rows[0];
    if (!s || !s.is_consignment) throw notFound('Không tìm thấy hàng ký gửi');
    if (s.status !== 'sold') throw badRequest('Hàng ký gửi chưa bán, chưa thể thanh toán cho người ký gửi');
    if (s.consignment_settled_at) throw badRequest('Đã thanh toán cho người ký gửi trước đó');
    const code = await nextCode(q, 'PC');
    await q.query(`INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, payer_name, note, created_by)
      VALUES ($1,'payment','consignment_payment',$2,$3,'serial',$4,$5,$6,$7)`,
      [code, b.method, s.consignment_price || 0, s.id, s.consignor_name, `Thanh toán hàng ký gửi serial ${s.serial_number}`, req.user!.id]);
    await q.query(`UPDATE product_serials SET consignment_settled_at=now() WHERE id=$1`, [s.id]);
    await audit(req, 'create', 'cash_transaction', code, `Thanh toán ký gửi ${s.serial_number} cho ${s.consignor_name}`, undefined, q);
    return { code };
  });
  res.json(out);
});

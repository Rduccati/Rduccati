import { Router } from 'express';
import { z } from 'zod';
import { db, nextCode } from '../db.ts';
import { audit, badRequest, hasPerm, notFound, paging, requirePerm, escapeLike, getSetting, zOptStr } from '../core.ts';
import { cancelOrder, checkPromotion, createOrder, orderSchema, returnOrder, returnSchema } from '../services/sales.ts';
import { sendExcel } from '../excel.ts';

export const router = Router();

// ------------------------------------------------------------------ POS: tìm sản phẩm
const posCols = `p.id, p.sku, p.barcode, p.name, p.model, p.reference_number, p.sale_price, p.promo_price, p.track_serial, p.images, p.warranty_months, p.condition, b.name brand_name`;
async function attachSerials(rows: any[], warehouseId: number) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const serials = (await db().query(`SELECT id, product_id, serial_number, movement_number, condition, is_consignment FROM product_serials
      WHERE product_id = ANY($1::int[]) AND status='in_stock' AND warehouse_id=$2 ORDER BY received_at`, [ids, warehouseId])).rows;
  const stock = (await db().query(`SELECT product_id, quantity FROM stock_levels WHERE product_id = ANY($1::int[]) AND warehouse_id=$2`, [ids, warehouseId])).rows;
  return rows.map((r) => ({
    ...r,
    serials: serials.filter((s: any) => s.product_id === r.id),
    available: stock.find((s: any) => s.product_id === r.id)?.quantity ?? 0,
  }));
}

router.get('/pos/search', requirePerm('pos.sell'), async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const wh = Number(req.query.warehouse_id);
  if (!wh) throw badRequest('Chọn kho bán hàng');
  const p: any[] = [wh];
  let cond = '';
  if (q) {
    p.push(`%${escapeLike(q)}%`);
    cond = `AND (p.name ILIKE $2 OR p.sku ILIKE $2 OR p.barcode ILIKE $2 OR p.model ILIKE $2 OR p.reference_number ILIKE $2 OR b.name ILIKE $2
      OR EXISTS (SELECT 1 FROM product_serials ps WHERE ps.product_id=p.id AND ps.serial_number ILIKE $2 AND ps.status='in_stock'))`;
  }
  const rows = (await db().query(`SELECT ${posCols} FROM products p LEFT JOIN brands b ON b.id=p.brand_id
      WHERE p.is_active AND coalesce((SELECT quantity FROM stock_levels s WHERE s.product_id=p.id AND s.warehouse_id=$1),0) > 0 ${cond}
      ORDER BY p.name LIMIT 40`, p)).rows;
  res.json(await attachSerials(rows, wh));
});

/** Tra cứu chính xác bằng máy quét: barcode / SKU / serial */
router.get('/pos/lookup', requirePerm('pos.sell'), async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  const wh = Number(req.query.warehouse_id);
  if (!code || !wh) throw badRequest('Thiếu mã hoặc kho');
  const bySerial = (await db().query(`SELECT ps.id, ps.product_id, ps.status, ps.warehouse_id FROM product_serials ps WHERE upper(ps.serial_number)=upper($1)`, [code])).rows[0];
  if (bySerial) {
    if (bySerial.status !== 'in_stock') throw badRequest(`Serial ${code} không còn trong kho (trạng thái: ${bySerial.status})`);
    if (bySerial.warehouse_id !== wh) throw badRequest(`Serial ${code} đang nằm ở kho khác`);
    const rows = await attachSerials((await db().query(`SELECT ${posCols} FROM products p LEFT JOIN brands b ON b.id=p.brand_id WHERE p.id=$1`, [bySerial.product_id])).rows, wh);
    return res.json({ product: rows[0], serial_id: bySerial.id });
  }
  const prod = (await db().query(`SELECT ${posCols}, p.is_active FROM products p LEFT JOIN brands b ON b.id=p.brand_id WHERE p.barcode=$1 OR upper(p.sku)=upper($1)`, [code])).rows[0];
  if (!prod) throw notFound(`Không tìm thấy sản phẩm với mã "${code}"`);
  if (!prod.is_active) throw badRequest('Sản phẩm đã ngừng kinh doanh');
  const rows = await attachSerials([prod], wh);
  res.json({ product: rows[0], serial_id: null });
});

router.post('/promotions/check', requirePerm('pos.sell'), async (req, res) => {
  const b = z.object({ code: z.string().trim().min(1), subtotal: z.coerce.number().min(0) }).parse(req.body);
  const r = await checkPromotion(db(), b.code, b.subtotal);
  res.json({ id: r.promotion.id, code: r.promotion.code, name: r.promotion.name, amount: r.amount });
});

// ------------------------------------------------------------------ Đơn hàng
router.post('/orders', requirePerm('pos.sell'), async (req, res) => {
  const b = orderSchema.parse(req.body);
  delete (b as any).created_at;
  const maintenance = await getSetting<any>('maintenance', {});
  const order = await db().tx(async (q) => {
    const o = await createOrder(q, b, req.user!.id, { maintenance_months: Number(maintenance.interval_months ?? 36) });
    await audit(req, 'create', 'order', o.id, `Tạo đơn ${o.code} – ${o.total.toLocaleString('vi-VN')}đ`, undefined, q);
    return o;
  });
  res.json(order);
});

const orderListSql = (where: string) => `FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.created_by ${where}`;
function orderFilters(qs: Record<string, string>) {
  const cond: string[] = [];
  const p: any[] = [];
  if (qs.q) { p.push(`%${escapeLike(qs.q)}%`); cond.push(`(o.code ILIKE $${p.length} OR c.name ILIKE $${p.length} OR c.phone ILIKE $${p.length} OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND (i.serial_number ILIKE $${p.length} OR i.product_name ILIKE $${p.length} OR i.sku ILIKE $${p.length})))`); }
  if (qs.status) { p.push(qs.status); cond.push(`o.status=$${p.length}`); }
  if (qs.customer_id) { p.push(qs.customer_id); cond.push(`o.customer_id=$${p.length}`); }
  if (qs.created_by) { p.push(qs.created_by); cond.push(`o.created_by=$${p.length}`); }
  if (qs.from) { p.push(qs.from); cond.push(`o.created_at >= $${p.length}::date`); }
  if (qs.to) { p.push(qs.to); cond.push(`o.created_at < $${p.length}::date + 1`); }
  if (qs.debt === '1') cond.push(`o.status<>'cancelled' AND o.total - o.refunded_amount - o.paid_amount > 0`);
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', p };
}

router.get('/orders', requirePerm('orders.view', 'pos.sell'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const qs = req.query as Record<string, string>;
  const { where, p } = orderFilters(qs);
  // Nhân viên chỉ có quyền bán hàng thì chỉ xem đơn của mình
  if (!hasPerm(req.user, 'orders.view')) { p.push(req.user!.id); }
  const w2 = !hasPerm(req.user, 'orders.view') ? (where ? where + ` AND o.created_by=$${p.length}` : `WHERE o.created_by=$${p.length}`) : where;
  const cols = `o.*, c.name customer_name, c.phone customer_phone, u.full_name created_by_name,
      (SELECT string_agg(product_name, ', ') FROM order_items i WHERE i.order_id=o.id) items_text,
      (SELECT string_agg(DISTINCT method, ',') FROM order_payments op WHERE op.order_id=o.id) methods`;
  if (qs.format === 'xlsx') {
    const rows = (await db().query(`SELECT ${cols} ${orderListSql(w2)} ORDER BY o.id DESC LIMIT 50000`, p)).rows;
    const st: Record<string, string> = { completed: 'Hoàn thành', cancelled: 'Đã hủy', returned: 'Đã trả hàng', partial_returned: 'Trả một phần' };
    return sendExcel(res, 'don-hang.xlsx', 'Đơn hàng', [
      { header: 'Mã đơn', key: 'code' }, { header: 'Thời gian', key: 'time', width: 18 }, { header: 'Khách hàng', key: 'customer_name', width: 22 },
      { header: 'SĐT', key: 'customer_phone', width: 13 }, { header: 'Sản phẩm', key: 'items_text', width: 40 }, { header: 'Tiền hàng', key: 'subtotal', money: true },
      { header: 'Giảm giá', key: 'disc', money: true }, { header: 'Tổng tiền', key: 'total', money: true }, { header: 'Đã thu', key: 'paid_amount', money: true },
      { header: 'Trả hàng', key: 'refunded_amount', money: true }, { header: 'Trạng thái', key: 'st' }, { header: 'Nhân viên', key: 'created_by_name', width: 18 },
    ], rows.map((r: any) => ({ ...r, st: st[r.status], disc: Number(r.discount_amount) + Number(r.promotion_amount), time: new Date(r.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) })));
  }
  const total = (await db().query(`SELECT count(*) c, coalesce(sum(CASE WHEN o.status<>'cancelled' THEN o.total - o.refunded_amount END),0) revenue ${orderListSql(w2)}`, p)).rows[0];
  p.push(pageSize, offset);
  const rows = (await db().query(`SELECT ${cols} ${orderListSql(w2)} ORDER BY o.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  res.json({ rows, total: total.c, revenue: total.revenue });
});

router.get('/orders/:id', requirePerm('orders.view', 'pos.sell'), async (req, res) => {
  const o = (await db().query(`SELECT o.*, c.name customer_name, c.phone customer_phone, c.address customer_address, c.code customer_code,
      u.full_name created_by_name, uu.full_name updated_by_name, w.name warehouse_name, pr.code promotion_code
      FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.created_by LEFT JOIN users uu ON uu.id=o.updated_by
      LEFT JOIN warehouses w ON w.id=o.warehouse_id LEFT JOIN promotions pr ON pr.id=o.promotion_id WHERE o.id=$1 OR o.code=$2`, [Number(req.params.id) || 0, req.params.id])).rows[0];
  if (!o) throw notFound('Đơn hàng không tồn tại');
  if (!hasPerm(req.user, 'orders.view') && o.created_by !== req.user!.id) throw notFound('Đơn hàng không tồn tại');
  const items = (await db().query(`SELECT i.*, p.warranty_months, b.name brand_name, p.model FROM order_items i JOIN products p ON p.id=i.product_id LEFT JOIN brands b ON b.id=p.brand_id WHERE order_id=$1 ORDER BY i.id`, [o.id])).rows;
  const payments = (await db().query(`SELECT * FROM order_payments WHERE order_id=$1 ORDER BY id`, [o.id])).rows;
  const returns = (await db().query(`SELECT r.*, u.full_name created_by_name, (SELECT json_agg(json_build_object('order_item_id', ri.order_item_id, 'quantity', ri.quantity, 'refund_amount', ri.refund_amount)) FROM order_return_items ri WHERE ri.return_id=r.id) items
      FROM order_returns r LEFT JOIN users u ON u.id=r.created_by WHERE order_id=$1 ORDER BY r.id`, [o.id])).rows;
  const warranties = (await db().query(`SELECT * FROM warranties WHERE order_id=$1 ORDER BY id`, [o.id])).rows;
  const showCost = hasPerm(req.user, 'products.cost');
  res.json({
    ...o, cost_total: showCost ? o.cost_total : undefined,
    items: showCost ? items : items.map((i: any) => ({ ...i, unit_cost: undefined })), payments, returns, warranties,
  });
});

router.put('/orders/:id', requirePerm('pos.sell', 'orders.view'), async (req, res) => {
  const b = z.object({ note: zOptStr }).parse(req.body);
  const r = await db().query(`UPDATE orders SET note=$2, updated_by=$3, updated_at=now() WHERE id=$1 RETURNING id, code`, [req.params.id, b.note, req.user!.id]);
  if (!r.rows[0]) throw notFound();
  await audit(req, 'update', 'order', r.rows[0].id, `Sửa ghi chú đơn ${r.rows[0].code}`);
  res.json({ ok: true });
});

router.post('/orders/:id/cancel', requirePerm('orders.cancel'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(1, 'Nhập lý do hủy đơn') }).parse(req.body);
  await db().tx(async (q) => {
    await cancelOrder(q, Number(req.params.id), reason, req.user!.id);
    await audit(req, 'cancel', 'order', req.params.id as string, `Hủy đơn #${req.params.id}: ${reason}`, undefined, q);
  });
  res.json({ ok: true });
});

router.post('/orders/:id/return', requirePerm('orders.return'), async (req, res) => {
  const b = returnSchema.parse(req.body);
  const r = await db().tx(async (q) => {
    const ret = await returnOrder(q, Number(req.params.id), b, req.user!.id);
    await audit(req, 'return', 'order', req.params.id as string, `Trả hàng ${ret.code}: hoàn ${ret.refund_amount.toLocaleString('vi-VN')}đ`, undefined, q);
    return ret;
  });
  res.json(r);
});

router.post('/orders/:id/printed', requirePerm('pos.sell', 'orders.view'), async (req, res) => {
  const r = await db().query(`UPDATE orders SET print_count = print_count + 1 WHERE id=$1 RETURNING code, print_count`, [req.params.id]);
  if (!r.rows[0]) throw notFound();
  if (r.rows[0].print_count > 1) await audit(req, 'print', 'order', req.params.id as string, `In lại hóa đơn ${r.rows[0].code} (lần ${r.rows[0].print_count})`);
  res.json(r.rows[0]);
});

// ------------------------------------------------------------------ Ca bán hàng & đối soát tiền mặt
async function shiftSummary(shiftId: number) {
  const s = (await db().query(`SELECT cs.*, u.full_name user_name FROM cash_shifts cs JOIN users u ON u.id=cs.user_id WHERE cs.id=$1`, [shiftId])).rows[0];
  if (!s) throw notFound('Không tìm thấy ca');
  const tx = (await db().query(`SELECT tx_type, method, category, sum(amount) amount, count(*) n FROM cash_transactions WHERE shift_id=$1 GROUP BY tx_type, method, category`, [shiftId])).rows;
  const orders = (await db().query(`SELECT count(*) FILTER (WHERE status<>'cancelled') order_count, count(*) FILTER (WHERE status='cancelled') cancelled_count,
      coalesce(sum(total - refunded_amount) FILTER (WHERE status<>'cancelled'),0) revenue FROM orders WHERE shift_id=$1`, [shiftId])).rows[0];
  const sum = (f: (r: any) => boolean) => tx.filter(f).reduce((a: number, r: any) => a + Number(r.amount), 0);
  const cashIn = sum((r) => r.method === 'cash' && r.tx_type === 'receipt');
  const cashOut = sum((r) => r.method === 'cash' && r.tx_type === 'payment');
  return {
    ...s, ...orders,
    cash_in: cashIn, cash_out: cashOut,
    transfer_in: sum((r) => r.method === 'transfer' && r.tx_type === 'receipt'),
    card_in: sum((r) => r.method === 'card' && r.tx_type === 'receipt'),
    expected_cash_now: Number(s.opening_cash) + cashIn - cashOut,
    breakdown: tx,
  };
}
router.get('/shifts/current', requirePerm('pos.sell'), async (req, res) => {
  const s = (await db().query(`SELECT id FROM cash_shifts WHERE user_id=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [req.user!.id])).rows[0];
  res.json(s ? await shiftSummary(s.id) : null);
});
router.post('/shifts/open', requirePerm('pos.sell'), async (req, res) => {
  const b = z.object({ opening_cash: z.coerce.number().int().min(0).default(0), note: zOptStr }).parse(req.body);
  const out = await db().tx(async (q) => {
    const ex = (await q.query(`SELECT id FROM cash_shifts WHERE user_id=$1 AND status='open'`, [req.user!.id])).rows[0];
    if (ex) throw badRequest('Bạn đang có ca bán hàng chưa đóng');
    const code = await nextCode(q, 'CA', 5);
    return (await q.query(`INSERT INTO cash_shifts(code, user_id, opening_cash, note) VALUES ($1,$2,$3,$4) RETURNING *`, [code, req.user!.id, b.opening_cash, b.note])).rows[0];
  });
  await audit(req, 'create', 'shift', out.id, `Mở ca ${out.code}, tiền đầu ca ${b.opening_cash.toLocaleString('vi-VN')}đ`);
  res.json(out);
});
router.post('/shifts/:id/close', requirePerm('pos.sell'), async (req, res) => {
  const b = z.object({ counted_cash: z.coerce.number().int().min(0), note: zOptStr }).parse(req.body);
  const sum = await shiftSummary(Number(req.params.id));
  if (sum.status !== 'open') throw badRequest('Ca đã được đóng');
  if (sum.user_id !== req.user!.id && !hasPerm(req.user, 'finance.edit')) throw badRequest('Bạn chỉ được đóng ca của mình');
  const diff = b.counted_cash - sum.expected_cash_now;
  await db().query(`UPDATE cash_shifts SET status='closed', closed_at=now(), expected_cash=$2, counted_cash=$3, difference=$4, note=coalesce($5, note) WHERE id=$1`,
    [sum.id, sum.expected_cash_now, b.counted_cash, diff, b.note]);
  await audit(req, 'close', 'shift', sum.id, `Đóng ca ${sum.code}: dự kiến ${sum.expected_cash_now.toLocaleString('vi-VN')}đ, thực đếm ${b.counted_cash.toLocaleString('vi-VN')}đ, chênh lệch ${diff.toLocaleString('vi-VN')}đ`);
  res.json(await shiftSummary(sum.id));
});
router.get('/shifts', requirePerm('finance.view', 'pos.sell'), async (req, res) => {
  const p: any[] = [];
  let where = '';
  if (!hasPerm(req.user, 'finance.view')) { p.push(req.user!.id); where = 'WHERE cs.user_id=$1'; }
  const rows = (await db().query(`SELECT cs.*, u.full_name user_name,
      (SELECT count(*) FROM orders o WHERE o.shift_id=cs.id AND o.status<>'cancelled') order_count,
      (SELECT coalesce(sum(total - refunded_amount),0) FROM orders o WHERE o.shift_id=cs.id AND o.status<>'cancelled') revenue
      FROM cash_shifts cs JOIN users u ON u.id=cs.user_id ${where} ORDER BY cs.id DESC LIMIT 200`, p)).rows;
  res.json(rows);
});
router.get('/shifts/:id', requirePerm('finance.view', 'pos.sell'), async (req, res) => {
  const s = await shiftSummary(Number(req.params.id));
  if (!hasPerm(req.user, 'finance.view') && s.user_id !== req.user!.id) throw notFound();
  res.json(s);
});

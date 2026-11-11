/**
 * Nghiệp vụ bán hàng: tạo đơn, hủy đơn, trả hàng. Server tự tính lại toàn bộ tiền – không tin số liệu từ client.
 */
import { z } from 'zod';
import { nextCode, type Queryable } from '../db.ts';
import { badRequest, notFound, postMovement, zOptStr } from '../core.ts';

export const orderSchema = z.object({
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  warehouse_id: z.coerce.number().int().positive(),
  items: z.array(z.object({
    product_id: z.coerce.number().int().positive(),
    serial_id: z.coerce.number().int().positive().optional().nullable(),
    quantity: z.coerce.number().int().positive('Số lượng phải > 0'),
    unit_price: z.coerce.number().int().min(0).optional(),
    discount: z.coerce.number().int().min(0).default(0), // giảm giá trên dòng (tiền)
  })).min(1, 'Giỏ hàng trống'),
  discount_type: z.enum(['percent', 'amount']).optional().nullable(),
  discount_value: z.coerce.number().min(0).default(0),
  promotion_code: zOptStr,
  payments: z.array(z.object({
    method: z.enum(['cash', 'transfer', 'card']),
    amount: z.coerce.number().int().min(0),
    reference: zOptStr,
  })).default([]),
  customer_given: z.coerce.number().int().min(0).default(0),
  allow_debt: z.boolean().default(false),
  note: zOptStr,
  created_at: z.string().optional(), // nội bộ: dữ liệu mẫu
});
export type OrderInput = z.infer<typeof orderSchema>;

export async function checkPromotion(q: Queryable, code: string, subtotal: number, at = new Date()) {
  const r = await q.query(`SELECT * FROM promotions WHERE upper(code)=upper($1)`, [code]);
  const p = r.rows[0];
  if (!p) throw badRequest('Mã khuyến mãi không tồn tại');
  if (!p.is_active) throw badRequest('Mã khuyến mãi đã ngừng áp dụng');
  const day = at.toISOString().slice(0, 10);
  if (p.start_date && day < p.start_date) throw badRequest('Mã khuyến mãi chưa đến thời gian áp dụng');
  if (p.end_date && day > p.end_date) throw badRequest('Mã khuyến mãi đã hết hạn');
  if (p.usage_limit && p.used_count >= p.usage_limit) throw badRequest('Mã khuyến mãi đã hết lượt sử dụng');
  if (subtotal < Number(p.min_order)) throw badRequest(`Đơn tối thiểu ${Number(p.min_order).toLocaleString('vi-VN')}đ để áp dụng mã`);
  let amount = p.discount_type === 'percent' ? Math.round((subtotal * Number(p.discount_value)) / 100) : Number(p.discount_value);
  if (p.max_discount) amount = Math.min(amount, Number(p.max_discount));
  amount = Math.min(amount, subtotal);
  return { promotion: p, amount };
}

function addMonths(dateStr: string, months: number) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function vnDate(iso: string) {
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export async function createOrder(q: Queryable, input: OrderInput, userId: number | null, settings: { maintenance_months: number }) {
  const d = input;
  const createdAt = d.created_at || new Date().toISOString();
  if (d.customer_id) {
    const c = await q.query(`SELECT id FROM customers WHERE id=$1`, [d.customer_id]);
    if (!c.rows[0]) throw badRequest('Khách hàng không tồn tại');
  }
  const serialSeen = new Set<number>();
  const lines: any[] = [];
  for (const it of d.items) {
    const p = (await q.query(`SELECT * FROM products WHERE id=$1`, [it.product_id])).rows[0];
    if (!p) throw badRequest(`Sản phẩm #${it.product_id} không tồn tại`);
    if (!p.is_active) throw badRequest(`Sản phẩm ${p.name} đã ngừng kinh doanh`);
    let serial: any = null;
    if (p.track_serial) {
      if (!it.serial_id) throw badRequest(`${p.name}: cần chọn Serial Number của chiếc đồng hồ bán ra`);
      if (it.quantity !== 1) throw badRequest(`${p.name}: mỗi serial chỉ bán số lượng 1`);
      if (serialSeen.has(it.serial_id)) throw badRequest('Một serial bị chọn nhiều lần trong giỏ hàng');
      serialSeen.add(it.serial_id);
      serial = (await q.query(`SELECT * FROM product_serials WHERE id=$1 FOR UPDATE`, [it.serial_id])).rows[0];
      if (!serial || serial.product_id !== p.id) throw badRequest(`${p.name}: serial không hợp lệ`);
      if (serial.status !== 'in_stock') throw badRequest(`Serial ${serial.serial_number} đã bán hoặc không còn trong kho`);
      if (serial.warehouse_id !== d.warehouse_id) throw badRequest(`Serial ${serial.serial_number} không nằm ở kho bán hàng`);
    }
    const listPrice = p.promo_price != null && Number(p.promo_price) > 0 ? Number(p.promo_price) : Number(p.sale_price);
    const unitPrice = it.unit_price ?? listPrice;
    const gross = unitPrice * it.quantity;
    if (it.discount > gross) throw badRequest(`${p.name}: giảm giá vượt quá thành tiền`);
    const unitCost = serial ? Number(serial.cost_price) : Number(p.cost_price);
    lines.push({ p, serial, qty: it.quantity, unitPrice, discount: it.discount, lineTotal: gross - it.discount, unitCost });
  }

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const itemDiscount = lines.reduce((s, l) => s + l.discount, 0);
  let discountAmount = 0;
  if (d.discount_type && d.discount_value > 0) {
    if (d.discount_type === 'percent') {
      if (d.discount_value > 100) throw badRequest('Giảm giá phần trăm tối đa 100%');
      discountAmount = Math.round((subtotal * d.discount_value) / 100);
    } else discountAmount = Math.round(d.discount_value);
  }
  if (discountAmount > subtotal) throw badRequest('Giảm giá vượt quá tổng tiền hàng');
  let promotionId: number | null = null;
  let promotionAmount = 0;
  if (d.promotion_code) {
    const pr = await checkPromotion(q, d.promotion_code, subtotal - discountAmount, new Date(createdAt));
    promotionId = pr.promotion.id;
    promotionAmount = pr.amount;
  }
  const total = Math.max(0, subtotal - discountAmount - promotionAmount);
  const payments = d.payments.filter((p) => p.amount > 0);
  const nonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0);
  const cashGiven = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  if (nonCash > total) throw badRequest('Số tiền chuyển khoản/thẻ vượt quá tổng đơn hàng');
  const cashNeeded = total - nonCash;
  const cashApplied = Math.min(cashGiven, cashNeeded);
  const change = Math.max(0, cashGiven - cashNeeded);
  const paid = nonCash + cashApplied;
  if (paid < total) {
    if (!d.allow_debt) throw badRequest(`Khách thanh toán chưa đủ. Còn thiếu ${(total - paid).toLocaleString('vi-VN')}đ`);
    if (!d.customer_id) throw badRequest('Bán nợ cần chọn khách hàng');
  }
  const costTotal = lines.reduce((s, l) => s + l.unitCost * l.qty, 0);

  const shift = userId ? (await q.query(`SELECT id FROM cash_shifts WHERE user_id=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [userId])).rows[0] : null;
  const code = await nextCode(q, 'DH');
  const order = (await q.query(
    `INSERT INTO orders(code, customer_id, warehouse_id, shift_id, status, subtotal, item_discount, discount_type, discount_value, discount_amount,
       promotion_id, promotion_amount, total, paid_amount, customer_given, change_amount, cost_total, note, created_by, updated_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$19,$19) RETURNING *`,
    [code, d.customer_id ?? null, d.warehouse_id, shift?.id ?? null, subtotal, itemDiscount, d.discount_type ?? null,
     Math.round(d.discount_value), discountAmount, promotionId, promotionAmount, total, paid,
     d.customer_given || cashGiven, change, costTotal, d.note, userId, createdAt],
  )).rows[0];

  const saleDate = vnDate(createdAt);
  for (const l of lines) {
    await q.query(
      `INSERT INTO order_items(order_id, product_id, serial_id, product_name, sku, serial_number, quantity, unit_price, discount, line_total, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [order.id, l.p.id, l.serial?.id ?? null, l.p.name, l.p.sku, l.serial?.serial_number ?? null, l.qty, l.unitPrice, l.discount, l.lineTotal, l.unitCost],
    );
    await postMovement(q, {
      product_id: l.p.id, warehouse_id: d.warehouse_id, serial_id: l.serial?.id ?? null, qty_change: -l.qty, unit_cost: l.unitCost,
      ref_type: 'sale', ref_id: order.id, ref_code: code, note: l.serial?.serial_number ?? null, user_id: userId,
    });
    if (l.serial) {
      await q.query(`UPDATE product_serials SET status='sold', sold_at=$2 WHERE id=$1`, [l.serial.id, createdAt]);
      if (Number(l.p.warranty_months) > 0) {
        const wcode = await nextCode(q, 'BH');
        const w = (await q.query(
          `INSERT INTO warranties(code, order_id, customer_id, product_id, serial_id, serial_number, product_name, start_date, end_date, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [wcode, order.id, d.customer_id ?? null, l.p.id, l.serial.id, l.serial.serial_number, l.p.name, saleDate,
           addMonths(saleDate, Number(l.p.warranty_months)), userId, createdAt],
        )).rows[0];
        if (d.customer_id && ['automatic', 'mechanical', 'spring_drive'].includes(l.p.movement_type) && settings.maintenance_months > 0) {
          await q.query(
            `INSERT INTO maintenance_reminders(customer_id, warranty_id, serial_number, product_name, due_date, reminder_type, note)
             VALUES ($1,$2,$3,$4,$5,'maintenance',$6)`,
            [d.customer_id, w.id, l.serial.serial_number, l.p.name, addMonths(saleDate, settings.maintenance_months), `Bảo dưỡng định kỳ đơn ${code}`],
          );
        }
      }
    }
  }

  // Thanh toán: ghi chi tiết + phiếu thu (dòng tiền)
  let remainingCash = cashApplied;
  for (const pm of payments) {
    const amt = pm.method === 'cash' ? Math.min(pm.amount, remainingCash) : pm.amount;
    if (pm.method === 'cash') remainingCash -= amt;
    if (amt <= 0) continue;
    await q.query(`INSERT INTO order_payments(order_id, method, amount, reference, created_at) VALUES ($1,$2,$3,$4,$5)`, [order.id, pm.method, amt, pm.reference, createdAt]);
    const pt = await nextCode(q, 'PT');
    await q.query(
      `INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, customer_id, shift_id, note, created_by, created_at)
       VALUES ($1,'receipt','sale',$2,$3,'order',$4,$5,$6,$7,$8,$9)`,
      [pt, pm.method, amt, order.id, d.customer_id ?? null, shift?.id ?? null, `Thu tiền đơn ${code}`, userId, createdAt],
    );
  }
  if (promotionId) await q.query(`UPDATE promotions SET used_count = used_count + 1 WHERE id=$1`, [promotionId]);
  return order;
}

export async function cancelOrder(q: Queryable, orderId: number, reason: string, userId: number | null) {
  const o = (await q.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [orderId])).rows[0];
  if (!o) throw notFound('Đơn hàng không tồn tại');
  if (o.status !== 'completed') throw badRequest('Chỉ hủy được đơn hàng đang ở trạng thái Hoàn thành (chưa trả hàng)');
  const items = (await q.query(`SELECT * FROM order_items WHERE order_id=$1`, [orderId])).rows;
  for (const it of items) {
    await postMovement(q, {
      product_id: it.product_id, warehouse_id: o.warehouse_id, serial_id: it.serial_id, qty_change: it.quantity, unit_cost: Number(it.unit_cost),
      ref_type: 'sale_cancel', ref_id: o.id, ref_code: o.code, note: `Hủy đơn: ${reason}`, user_id: userId,
    });
    if (it.serial_id) await q.query(`UPDATE product_serials SET status='in_stock', sold_at=NULL, warehouse_id=$2 WHERE id=$1`, [it.serial_id, o.warehouse_id]);
  }
  await q.query(`UPDATE warranties SET status='void', note=coalesce(note||' | ','')||'Hủy theo đơn '||$2 WHERE order_id=$1`, [o.id, o.code]);
  await q.query(`DELETE FROM maintenance_reminders WHERE warranty_id IN (SELECT id FROM warranties WHERE order_id=$1) AND status='pending'`, [o.id]);
  // Hoàn tiền đã thu: phiếu chi tương ứng từng phương thức
  const pays = (await q.query(`SELECT method, sum(amount) amount FROM order_payments WHERE order_id=$1 GROUP BY method`, [o.id])).rows;
  const shift = userId ? (await q.query(`SELECT id FROM cash_shifts WHERE user_id=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [userId])).rows[0] : null;
  for (const p of pays) {
    if (Number(p.amount) <= 0) continue;
    const pc = await nextCode(q, 'PC');
    await q.query(
      `INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, customer_id, shift_id, note, created_by)
       VALUES ($1,'payment','sale_refund',$2,$3,'order',$4,$5,$6,$7,$8)`,
      [pc, p.method, p.amount, o.id, o.customer_id, shift?.id ?? null, `Hoàn tiền hủy đơn ${o.code}`, userId],
    );
  }
  if (o.promotion_id) await q.query(`UPDATE promotions SET used_count = greatest(used_count - 1, 0) WHERE id=$1`, [o.promotion_id]);
  await q.query(`UPDATE orders SET status='cancelled', cancel_reason=$2, updated_by=$3, updated_at=now() WHERE id=$1`, [o.id, reason, userId]);
}

export const returnSchema = z.object({
  items: z.array(z.object({ order_item_id: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive() })).min(1, 'Chọn sản phẩm trả'),
  reason: z.string().trim().min(1, 'Nhập lý do trả hàng'),
  refund_method: z.enum(['cash', 'transfer']).default('cash'),
});

export async function returnOrder(q: Queryable, orderId: number, input: z.infer<typeof returnSchema>, userId: number | null) {
  const o = (await q.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [orderId])).rows[0];
  if (!o) throw notFound('Đơn hàng không tồn tại');
  if (!['completed', 'partial_returned'].includes(o.status)) throw badRequest('Đơn hàng không thể trả hàng');
  const items = (await q.query(`SELECT * FROM order_items WHERE order_id=$1`, [orderId])).rows;
  const code = await nextCode(q, 'TH');
  const ret = (await q.query(`INSERT INTO order_returns(code, order_id, reason, refund_method, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [code, o.id, input.reason, input.refund_method, userId])).rows[0];
  // Tỷ lệ phân bổ giảm giá cấp đơn hàng cho từng dòng
  const orderLevelDiscount = Number(o.discount_amount) + Number(o.promotion_amount);
  const ratio = Number(o.subtotal) > 0 ? (Number(o.subtotal) - orderLevelDiscount) / Number(o.subtotal) : 0;
  let refund = 0;
  let cost = 0;
  for (const r of input.items) {
    const it = items.find((x: any) => x.id === r.order_item_id);
    if (!it) throw badRequest('Sản phẩm trả không thuộc đơn hàng');
    if (r.quantity > it.quantity - it.returned_qty) throw badRequest(`${it.product_name}: số lượng trả vượt quá số lượng còn lại`);
    const lineRefund = Math.round((Number(it.line_total) / it.quantity) * r.quantity * ratio);
    refund += lineRefund;
    cost += Number(it.unit_cost) * r.quantity;
    await q.query(`INSERT INTO order_return_items(return_id, order_item_id, quantity, refund_amount) VALUES ($1,$2,$3,$4)`, [ret.id, it.id, r.quantity, lineRefund]);
    await q.query(`UPDATE order_items SET returned_qty = returned_qty + $2 WHERE id=$1`, [it.id, r.quantity]);
    await postMovement(q, {
      product_id: it.product_id, warehouse_id: o.warehouse_id, serial_id: it.serial_id, qty_change: r.quantity, unit_cost: Number(it.unit_cost),
      ref_type: 'sale_return', ref_id: ret.id, ref_code: code, note: `Trả hàng đơn ${o.code}`, user_id: userId,
    });
    if (it.serial_id) {
      await q.query(`UPDATE product_serials SET status='in_stock', sold_at=NULL, warehouse_id=$2, condition=CASE WHEN condition='new' THEN 'used' ELSE condition END WHERE id=$1`, [it.serial_id, o.warehouse_id]);
      await q.query(`UPDATE warranties SET status='void', note=coalesce(note||' | ','')||'Trả hàng '||$2 WHERE order_id=$1 AND serial_id=$3`, [o.id, code, it.serial_id]);
    }
  }
  // Không hoàn nhiều hơn số đã thu thực tế
  // paid_amount = số tiền thực thu ròng (đã trừ các lần hoàn tiền trước)
  const maxRefund = Math.max(0, Number(o.paid_amount));
  const cashRefund = Math.min(refund, maxRefund);
  await q.query(`UPDATE order_returns SET refund_amount=$2, cost_amount=$3 WHERE id=$1`, [ret.id, refund, cost]);
  if (cashRefund > 0) {
    const shift = userId ? (await q.query(`SELECT id FROM cash_shifts WHERE user_id=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [userId])).rows[0] : null;
    const pc = await nextCode(q, 'PC');
    await q.query(
      `INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, customer_id, shift_id, note, created_by)
       VALUES ($1,'payment','sale_refund',$2,$3,'order_return',$4,$5,$6,$7,$8)`,
      [pc, input.refund_method, cashRefund, ret.id, o.customer_id, shift?.id ?? null, `Hoàn tiền trả hàng ${code} (đơn ${o.code})`, userId],
    );
  }
  const left = (await q.query(`SELECT sum(quantity - returned_qty) left_qty FROM order_items WHERE order_id=$1`, [o.id])).rows[0];
  const status = Number(left.left_qty) === 0 ? 'returned' : 'partial_returned';
  await q.query(`UPDATE orders SET status=$2, refunded_amount = refunded_amount + $3, paid_amount = paid_amount - $5, updated_by=$4, updated_at=now() WHERE id=$1`, [o.id, status, refund, userId, cashRefund]);
  return { ...ret, refund_amount: refund, cash_refund: cashRefund };
}

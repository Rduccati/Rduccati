import { Router } from 'express';
import { z } from 'zod';
import { db, nextCode } from '../db.ts';
import { audit, badRequest, notFound, paging, requirePerm, escapeLike, zOptDate, zOptStr } from '../core.ts';

export const router = Router();

export const REPAIR_STATUS: Record<string, string> = {
  received: 'Đã tiếp nhận', diagnosing: 'Đang kiểm tra', repairing: 'Đang sửa chữa', waiting_parts: 'Chờ linh kiện',
  done: 'Sửa xong – chờ giao', delivered: 'Đã giao khách', cancelled: 'Đã hủy',
};

// ------------------------------------------------------------------ Phiếu bảo hành
router.get('/warranties', requirePerm('warranty.view'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const qs = req.query as Record<string, string>;
  const cond: string[] = [];
  const p: any[] = [];
  if (qs.q) { p.push(`%${escapeLike(qs.q)}%`); cond.push(`(w.code ILIKE $${p.length} OR w.serial_number ILIKE $${p.length} OR w.product_name ILIKE $${p.length} OR c.name ILIKE $${p.length} OR c.phone ILIKE $${p.length} OR o.code ILIKE $${p.length})`); }
  if (qs.state === 'active') cond.push(`w.status='active' AND w.end_date >= current_date`);
  if (qs.state === 'expiring') cond.push(`w.status='active' AND w.end_date BETWEEN current_date AND current_date + 30`);
  if (qs.state === 'expired') cond.push(`w.status='active' AND w.end_date < current_date`);
  if (qs.state === 'void') cond.push(`w.status='void'`);
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const base = `FROM warranties w LEFT JOIN customers c ON c.id=w.customer_id LEFT JOIN orders o ON o.id=w.order_id ${where}`;
  const total = (await db().query(`SELECT count(*) c ${base}`, p)).rows[0].c;
  p.push(pageSize, offset);
  const rows = (await db().query(`SELECT w.*, c.name customer_name, c.phone customer_phone, o.code order_code,
      CASE WHEN w.status='void' THEN 'void' WHEN w.end_date < current_date THEN 'expired' ELSE 'active' END state,
      (SELECT count(*) FROM repair_tickets r WHERE r.warranty_id=w.id) repair_count
      ${base} ORDER BY w.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  res.json({ rows, total });
});

router.get('/warranties/:id', requirePerm('warranty.view'), async (req, res) => {
  const w = (await db().query(`SELECT w.*, c.name customer_name, c.phone customer_phone, c.address customer_address, o.code order_code,
      p.sku, p.model, p.reference_number, b.name brand_name, ps.movement_number,
      CASE WHEN w.status='void' THEN 'void' WHEN w.end_date < current_date THEN 'expired' ELSE 'active' END state
      FROM warranties w LEFT JOIN customers c ON c.id=w.customer_id LEFT JOIN orders o ON o.id=w.order_id
      LEFT JOIN products p ON p.id=w.product_id LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN product_serials ps ON ps.id=w.serial_id
      WHERE w.id=$1 OR w.code=$2`, [Number(req.params.id) || 0, req.params.id])).rows[0];
  if (!w) throw notFound('Không tìm thấy phiếu bảo hành');
  const repairs = (await db().query(`SELECT * FROM repair_tickets WHERE warranty_id=$1 OR (serial_number IS NOT NULL AND upper(serial_number)=upper($2)) ORDER BY received_at DESC`, [w.id, w.serial_number])).rows;
  res.json({ ...w, repairs });
});

/** Tạo phiếu bảo hành thủ công (VD: khách mua trước khi dùng phần mềm, hoặc gia hạn bảo hành) */
const warrantySchema = z.object({
  serial_number: z.string().trim().min(1, 'Nhập Serial Number'),
  product_name: z.string().trim().optional(),
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày bắt đầu không hợp lệ'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày kết thúc không hợp lệ'),
  terms: zOptStr, note: zOptStr,
}).refine((v) => v.end_date >= v.start_date, { message: 'Ngày kết thúc phải sau ngày bắt đầu', path: ['end_date'] });
router.post('/warranties', requirePerm('warranty.edit'), async (req, res) => {
  const b = warrantySchema.parse(req.body);
  const out = await db().tx(async (q) => {
    const s = (await q.query(`SELECT ps.*, p.name product_name FROM product_serials ps JOIN products p ON p.id=ps.product_id WHERE upper(ps.serial_number)=upper($1)`, [b.serial_number])).rows[0];
    const name = s?.product_name || b.product_name;
    if (!name) throw badRequest('Serial chưa có trong hệ thống – nhập tên sản phẩm');
    const code = await nextCode(q, 'BH');
    const r = await q.query(`INSERT INTO warranties(code, customer_id, product_id, serial_id, serial_number, product_name, start_date, end_date, terms, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [code, b.customer_id ?? null, s?.product_id ?? null, s?.id ?? null, s?.serial_number ?? b.serial_number, name, b.start_date, b.end_date, b.terms, b.note, req.user!.id]);
    await audit(req, 'create', 'warranty', r.rows[0].id, `Tạo phiếu bảo hành ${code} cho serial ${b.serial_number}`, undefined, q);
    return r.rows[0];
  });
  res.json(out);
});
router.put('/warranties/:id', requirePerm('warranty.edit'), async (req, res) => {
  const b = z.object({ end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.enum(['active', 'void']), terms: zOptStr, note: zOptStr }).parse(req.body);
  const r = await db().query(`UPDATE warranties SET end_date=$2, status=$3, terms=$4, note=$5 WHERE id=$1 RETURNING code`, [req.params.id, b.end_date, b.status, b.terms, b.note]);
  if (!r.rows[0]) throw notFound();
  await audit(req, 'update', 'warranty', req.params.id as string, `Cập nhật bảo hành ${r.rows[0].code}`, b);
  res.json({ ok: true });
});

/** Tra cứu nhanh theo serial: thông tin bán, bảo hành, lịch sử sửa chữa */
router.get('/warranty-lookup', requirePerm('warranty.view'), async (req, res) => {
  const code = String(req.query.q ?? '').trim();
  if (!code) throw badRequest('Nhập serial, mã bảo hành hoặc SĐT');
  const warranties = (await db().query(`SELECT w.*, c.name customer_name, c.phone customer_phone, o.code order_code,
      CASE WHEN w.status='void' THEN 'void' WHEN w.end_date < current_date THEN 'expired' ELSE 'active' END state
      FROM warranties w LEFT JOIN customers c ON c.id=w.customer_id LEFT JOIN orders o ON o.id=w.order_id
      WHERE upper(w.serial_number)=upper($1) OR upper(w.code)=upper($1) OR c.phone=$1 ORDER BY w.id DESC`, [code])).rows;
  const repairs = (await db().query(`SELECT * FROM repair_tickets WHERE upper(serial_number)=upper($1) OR upper(code)=upper($1) OR customer_phone=$1 ORDER BY id DESC`, [code])).rows;
  res.json({ warranties, repairs });
});

// ------------------------------------------------------------------ Phiếu nhận sửa chữa
router.get('/repairs', requirePerm('warranty.view'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const qs = req.query as Record<string, string>;
  const cond: string[] = [];
  const p: any[] = [];
  if (qs.q) { p.push(`%${escapeLike(qs.q)}%`); cond.push(`(r.code ILIKE $${p.length} OR r.customer_name ILIKE $${p.length} OR r.customer_phone ILIKE $${p.length} OR r.serial_number ILIKE $${p.length} OR r.watch_brand ILIKE $${p.length} OR r.watch_model ILIKE $${p.length})`); }
  if (qs.status === 'open') cond.push(`r.status NOT IN ('delivered','cancelled')`);
  else if (qs.status) { p.push(qs.status); cond.push(`r.status=$${p.length}`); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = (await db().query(`SELECT count(*) c FROM repair_tickets r ${where}`, p)).rows[0].c;
  const counts = (await db().query(`SELECT status, count(*) n FROM repair_tickets GROUP BY status`)).rows;
  p.push(pageSize, offset);
  const rows = (await db().query(`SELECT r.*, u.full_name created_by_name,
      coalesce((SELECT sum(quantity*unit_price) FROM repair_parts rp WHERE rp.ticket_id=r.id),0) parts_amount
      FROM repair_tickets r LEFT JOIN users u ON u.id=r.created_by ${where} ORDER BY r.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  res.json({ rows, total, counts });
});
router.get('/repairs/:id', requirePerm('warranty.view'), async (req, res) => {
  const r = (await db().query(`SELECT r.*, u.full_name created_by_name, w.code warranty_code, w.end_date warranty_end
      FROM repair_tickets r LEFT JOIN users u ON u.id=r.created_by LEFT JOIN warranties w ON w.id=r.warranty_id WHERE r.id=$1`, [req.params.id])).rows[0];
  if (!r) throw notFound('Không tìm thấy phiếu sửa chữa');
  const parts = (await db().query(`SELECT * FROM repair_parts WHERE ticket_id=$1 ORDER BY id`, [r.id])).rows;
  const logs = (await db().query(`SELECT l.*, u.full_name user_name FROM repair_logs l LEFT JOIN users u ON u.id=l.user_id WHERE ticket_id=$1 ORDER BY l.id`, [r.id])).rows;
  const payments = (await db().query(`SELECT * FROM cash_transactions WHERE ref_type='repair' AND ref_id=$1 ORDER BY id`, [r.id])).rows;
  res.json({ ...r, parts, logs, payments });
});
const repairSchema = z.object({
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  customer_name: z.string().trim().min(1, 'Nhập tên khách hàng'),
  customer_phone: zOptStr,
  watch_brand: zOptStr, watch_model: zOptStr, serial_number: zOptStr,
  receive_condition: zOptStr, accessories: zOptStr,
  issue: z.string().trim().min(1, 'Mô tả tình trạng/yêu cầu sửa chữa'),
  is_warranty: z.boolean().default(false),
  estimated_cost: z.coerce.number().int().min(0).default(0),
  deposit: z.coerce.number().int().min(0).default(0),
  deposit_method: z.enum(['cash', 'transfer']).default('cash'),
  technician: zOptStr, expected_at: zOptDate, note: zOptStr,
});
router.post('/repairs', requirePerm('warranty.edit'), async (req, res) => {
  const b = repairSchema.parse(req.body);
  const out = await db().tx(async (q) => {
    let warrantyId: number | null = null;
    let productId: number | null = null;
    if (b.serial_number) {
      const w = (await q.query(`SELECT id, product_id FROM warranties WHERE upper(serial_number)=upper($1) AND status='active' ORDER BY end_date DESC LIMIT 1`, [b.serial_number])).rows[0];
      warrantyId = w?.id ?? null;
      productId = w?.product_id ?? null;
    }
    let customerId = b.customer_id ?? null;
    if (!customerId && b.customer_phone) customerId = (await q.query(`SELECT id FROM customers WHERE phone=$1`, [b.customer_phone])).rows[0]?.id ?? null;
    const code = await nextCode(q, 'SC');
    const r = (await q.query(`INSERT INTO repair_tickets(code, customer_id, customer_name, customer_phone, warranty_id, product_id, watch_brand, watch_model, serial_number,
        receive_condition, accessories, issue, is_warranty, estimated_cost, deposit, technician, expected_at, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [code, customerId, b.customer_name, b.customer_phone, warrantyId, productId, b.watch_brand, b.watch_model, b.serial_number, b.receive_condition,
       b.accessories, b.issue, b.is_warranty, b.estimated_cost, b.deposit, b.technician, b.expected_at, b.note, req.user!.id])).rows[0];
    await q.query(`INSERT INTO repair_logs(ticket_id, status, note, user_id) VALUES ($1,'received',$2,$3)`, [r.id, 'Tiếp nhận đồng hồ', req.user!.id]);
    if (b.deposit > 0) {
      const pt = await nextCode(q, 'PT');
      await q.query(`INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, customer_id, payer_name, note, created_by)
        VALUES ($1,'receipt','repair_service',$2,$3,'repair',$4,$5,$6,$7,$8)`, [pt, b.deposit_method, b.deposit, r.id, customerId, b.customer_name, `Đặt cọc sửa chữa ${code}`, req.user!.id]);
    }
    await audit(req, 'create', 'repair', r.id, `Tiếp nhận sửa chữa ${code} – ${b.customer_name}`, undefined, q);
    return r;
  });
  res.json(out);
});
router.put('/repairs/:id', requirePerm('warranty.edit'), async (req, res) => {
  const b = repairSchema.omit({ deposit: true, deposit_method: true }).extend({ final_cost: z.coerce.number().int().min(0).default(0) }).parse(req.body);
  const r = await db().query(`UPDATE repair_tickets SET customer_name=$2, customer_phone=$3, watch_brand=$4, watch_model=$5, serial_number=$6, receive_condition=$7,
      accessories=$8, issue=$9, is_warranty=$10, estimated_cost=$11, final_cost=$12, technician=$13, expected_at=$14, note=$15, updated_at=now() WHERE id=$1 RETURNING code`,
    [req.params.id, b.customer_name, b.customer_phone, b.watch_brand, b.watch_model, b.serial_number, b.receive_condition, b.accessories, b.issue,
     b.is_warranty, b.estimated_cost, b.final_cost, b.technician, b.expected_at, b.note]);
  if (!r.rows[0]) throw notFound();
  await audit(req, 'update', 'repair', req.params.id as string, `Cập nhật phiếu sửa chữa ${r.rows[0].code}`);
  res.json({ ok: true });
});
router.post('/repairs/:id/status', requirePerm('warranty.edit'), async (req, res) => {
  const b = z.object({
    status: z.enum(['received', 'diagnosing', 'repairing', 'waiting_parts', 'done', 'delivered', 'cancelled']),
    note: zOptStr,
    final_cost: z.coerce.number().int().min(0).optional(),
    payment_method: z.enum(['cash', 'transfer']).default('cash'),
  }).parse(req.body);
  const out = await db().tx(async (q) => {
    const r = (await q.query(`SELECT * FROM repair_tickets WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!r) throw notFound();
    if (['delivered', 'cancelled'].includes(r.status)) throw badRequest('Phiếu đã kết thúc, không thể đổi trạng thái');
    const finalCost = b.final_cost ?? Number(r.final_cost);
    let collected = 0;
    if (b.status === 'delivered') {
      const paid = (await q.query(`SELECT coalesce(sum(CASE WHEN tx_type='receipt' THEN amount ELSE -amount END),0) s FROM cash_transactions WHERE ref_type='repair' AND ref_id=$1`, [r.id])).rows[0].s;
      collected = Math.max(0, finalCost - Number(paid));
      if (collected > 0) {
        const pt = await nextCode(q, 'PT');
        await q.query(`INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, customer_id, payer_name, note, created_by)
          VALUES ($1,'receipt','repair_service',$2,$3,'repair',$4,$5,$6,$7,$8)`, [pt, b.payment_method, collected, r.id, r.customer_id, r.customer_name, `Thu phí sửa chữa ${r.code}`, req.user!.id]);
      } else if (Number(paid) > finalCost) {
        const pc = await nextCode(q, 'PC');
        await q.query(`INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, customer_id, payer_name, note, created_by)
          VALUES ($1,'payment','repair_refund',$2,$3,'repair',$4,$5,$6,$7,$8)`, [pc, b.payment_method, Number(paid) - finalCost, r.id, r.customer_id, r.customer_name, `Hoàn tiền cọc thừa ${r.code}`, req.user!.id]);
      }
    }
    if (b.status === 'cancelled') {
      const paid = (await q.query(`SELECT coalesce(sum(CASE WHEN tx_type='receipt' THEN amount ELSE -amount END),0) s FROM cash_transactions WHERE ref_type='repair' AND ref_id=$1`, [r.id])).rows[0].s;
      if (Number(paid) > 0) {
        const pc = await nextCode(q, 'PC');
        await q.query(`INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, customer_id, payer_name, note, created_by)
          VALUES ($1,'payment','repair_refund',$2,$3,'repair',$4,$5,$6,$7,$8)`, [pc, b.payment_method, paid, r.id, r.customer_id, r.customer_name, `Hoàn cọc do hủy phiếu ${r.code}`, req.user!.id]);
      }
    }
    await q.query(`UPDATE repair_tickets SET status=$2, final_cost=$3, delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END, updated_at=now() WHERE id=$1`, [r.id, b.status, finalCost]);
    await q.query(`INSERT INTO repair_logs(ticket_id, status, note, user_id) VALUES ($1,$2,$3,$4)`, [r.id, b.status, b.note, req.user!.id]);
    await audit(req, 'update', 'repair', r.id, `Phiếu ${r.code}: ${REPAIR_STATUS[r.status]} → ${REPAIR_STATUS[b.status]}`, undefined, q);
    return { collected };
  });
  res.json(out);
});
router.post('/repairs/:id/parts', requirePerm('warranty.edit'), async (req, res) => {
  const b = z.object({ part_name: z.string().trim().min(1, 'Nhập tên linh kiện'), quantity: z.coerce.number().int().positive().default(1), unit_cost: z.coerce.number().int().min(0).default(0), unit_price: z.coerce.number().int().min(0).default(0) }).parse(req.body);
  const r = await db().query(`INSERT INTO repair_parts(ticket_id, part_name, quantity, unit_cost, unit_price) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.params.id, b.part_name, b.quantity, b.unit_cost, b.unit_price]);
  await audit(req, 'create', 'repair_part', r.rows[0].id, `Thêm linh kiện "${b.part_name}" vào phiếu #${req.params.id}`);
  res.json(r.rows[0]);
});
router.delete('/repairs/:id/parts/:partId', requirePerm('warranty.edit'), async (req, res) => {
  await db().query(`DELETE FROM repair_parts WHERE id=$1 AND ticket_id=$2`, [req.params.partId, req.params.id]);
  await audit(req, 'delete', 'repair_part', req.params.partId as string, `Xóa linh kiện khỏi phiếu #${req.params.id}`);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Nhắc lịch bảo dưỡng
router.get('/reminders', requirePerm('warranty.view', 'customers.view'), async (req, res) => {
  const qs = req.query as Record<string, string>;
  const cond = [`m.status = $1`];
  const p: any[] = [qs.status || 'pending'];
  if (qs.range === 'due') cond.push(`m.due_date <= current_date + 30`);
  const rows = (await db().query(`SELECT m.*, c.name customer_name, c.phone customer_phone FROM maintenance_reminders m LEFT JOIN customers c ON c.id=m.customer_id
      WHERE ${cond.join(' AND ')} ORDER BY m.due_date LIMIT 500`, p)).rows;
  res.json(rows);
});
router.post('/reminders', requirePerm('warranty.edit'), async (req, res) => {
  const b = z.object({ customer_id: z.coerce.number().int().positive('Chọn khách hàng'), serial_number: zOptStr, product_name: zOptStr, due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Chọn ngày'), reminder_type: z.enum(['maintenance', 'battery', 'warranty_expiry', 'other']).default('maintenance'), note: zOptStr }).parse(req.body);
  const r = await db().query(`INSERT INTO maintenance_reminders(customer_id, serial_number, product_name, due_date, reminder_type, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.customer_id, b.serial_number, b.product_name, b.due_date, b.reminder_type, b.note]);
  res.json(r.rows[0]);
});
router.put('/reminders/:id', requirePerm('warranty.edit'), async (req, res) => {
  const b = z.object({ status: z.enum(['pending', 'done', 'skipped']), note: zOptStr, due_date: zOptDate }).parse(req.body);
  await db().query(`UPDATE maintenance_reminders SET status=$2, note=coalesce($3, note), due_date=coalesce($4::date, due_date) WHERE id=$1`, [req.params.id, b.status, b.note, b.due_date]);
  await audit(req, 'update', 'reminder', req.params.id as string, `Cập nhật nhắc bảo dưỡng → ${b.status}`);
  res.json({ ok: true });
});

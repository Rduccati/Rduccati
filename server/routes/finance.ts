/** Thu chi, công nợ và báo cáo. Phân biệt rõ: Doanh thu ≠ Lợi nhuận gộp ≠ Lợi nhuận ròng ≠ Dòng tiền */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { db, nextCode } from '../db.ts';
import { audit, badRequest, hasPerm, notFound, paging, requirePerm, escapeLike, getSetting, zOptStr } from '../core.ts';
import { sendExcel, type Col } from '../excel.ts';
import { customerDebtSql } from './partners.ts';

export const router = Router();

export const CATEGORY_LABEL: Record<string, string> = {
  sale: 'Thu tiền bán hàng', customer_debt: 'Thu nợ khách hàng', repair_service: 'Thu dịch vụ sửa chữa', other_income: 'Thu nhập khác',
  capital: 'Góp vốn / nạp quỹ', supplier_refund: 'NCC hoàn tiền',
  supplier_payment: 'Trả tiền nhà cung cấp', consignment_payment: 'Thanh toán hàng ký gửi', sale_refund: 'Hoàn tiền khách (hủy/trả hàng)',
  repair_refund: 'Hoàn tiền sửa chữa', rent: 'Thuê mặt bằng', salary: 'Lương nhân viên', utilities: 'Điện nước, internet', marketing: 'Quảng cáo, marketing',
  repair_cost: 'Chi phí sửa chữa / linh kiện', shipping: 'Vận chuyển', tax: 'Thuế, phí', other_expense: 'Chi phí khác', withdraw: 'Rút quỹ / chủ rút vốn',
};
/** Các khoản chi được tính là CHI PHÍ hoạt động trong báo cáo lãi lỗ */
export const EXPENSE_CATEGORIES = ['rent', 'salary', 'utilities', 'marketing', 'repair_cost', 'shipping', 'tax', 'other_expense'];
/** Thu nhập khác ngoài bán hàng (tính vào lãi lỗ) */
export const OTHER_INCOME_CATEGORIES = ['repair_service', 'other_income'];
const MANUAL_RECEIPT = ['customer_debt', 'other_income', 'capital', 'supplier_refund', 'repair_service'];
const MANUAL_PAYMENT = ['supplier_payment', 'rent', 'salary', 'utilities', 'marketing', 'repair_cost', 'shipping', 'tax', 'other_expense', 'withdraw'];

router.get('/finance/categories', (_req, res) => res.json({ labels: CATEGORY_LABEL, receipt: MANUAL_RECEIPT, payment: MANUAL_PAYMENT, expense: EXPENSE_CATEGORIES }));

function txFilters(qs: Record<string, string>) {
  const cond: string[] = [];
  const p: any[] = [];
  if (qs.type) { p.push(qs.type); cond.push(`t.tx_type=$${p.length}`); }
  if (qs.method) { p.push(qs.method); cond.push(`t.method=$${p.length}`); }
  if (qs.category) { p.push(qs.category); cond.push(`t.category=$${p.length}`); }
  if (qs.q) { p.push(`%${escapeLike(qs.q)}%`); cond.push(`(t.code ILIKE $${p.length} OR t.note ILIKE $${p.length} OR t.payer_name ILIKE $${p.length} OR c.name ILIKE $${p.length} OR s.name ILIKE $${p.length})`); }
  if (qs.from) { p.push(qs.from); cond.push(`t.created_at >= $${p.length}::date`); }
  if (qs.to) { p.push(qs.to); cond.push(`t.created_at < $${p.length}::date + 1`); }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', p };
}
const txBase = (where: string) => `FROM cash_transactions t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN suppliers s ON s.id=t.supplier_id LEFT JOIN users u ON u.id=t.created_by ${where}`;

router.get('/finance/transactions', requirePerm('finance.view'), async (req, res) => {
  const { pageSize, offset } = paging(req);
  const qs = req.query as Record<string, string>;
  const { where, p } = txFilters(qs);
  const cols = `t.*, c.name customer_name, s.name supplier_name, u.full_name created_by_name`;
  if (qs.format === 'xlsx') {
    const rows = (await db().query(`SELECT ${cols} ${txBase(where)} ORDER BY t.id DESC LIMIT 50000`, p)).rows;
    return sendExcel(res, 'so-thu-chi.xlsx', 'Thu chi', [
      { header: 'Mã phiếu', key: 'code' }, { header: 'Thời gian', key: 'time', width: 18 }, { header: 'Loại', key: 'type' }, { header: 'Hạng mục', key: 'cat', width: 26 },
      { header: 'Hình thức', key: 'm' }, { header: 'Số tiền', key: 'amount', money: true }, { header: 'Đối tượng', key: 'party', width: 24 },
      { header: 'Diễn giải', key: 'note', width: 36 }, { header: 'Người lập', key: 'created_by_name', width: 18 },
    ], rows.map((r: any) => ({
      ...r, time: new Date(r.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), type: r.tx_type === 'receipt' ? 'Thu' : 'Chi',
      cat: CATEGORY_LABEL[r.category] ?? r.category, m: { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' }[r.method as string],
      party: r.customer_name || r.supplier_name || r.payer_name,
    })));
  }
  const sum = (await db().query(`SELECT count(*) c, coalesce(sum(amount) FILTER (WHERE tx_type='receipt'),0) receipt, coalesce(sum(amount) FILTER (WHERE tx_type='payment'),0) payment ${txBase(where)}`, p)).rows[0];
  p.push(pageSize, offset);
  const rows = (await db().query(`SELECT ${cols} ${txBase(where)} ORDER BY t.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
  res.json({ rows, total: sum.c, receipt: sum.receipt, payment: sum.payment });
});

const txSchema = z.object({
  tx_type: z.enum(['receipt', 'payment']),
  category: z.string(),
  method: z.enum(['cash', 'transfer', 'card']),
  amount: z.coerce.number().int().positive('Số tiền phải > 0'),
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  supplier_id: z.coerce.number().int().positive().optional().nullable(),
  payer_name: zOptStr,
  note: zOptStr,
});
router.post('/finance/transactions', requirePerm('finance.edit'), async (req, res) => {
  const b = txSchema.parse(req.body);
  const allowed = b.tx_type === 'receipt' ? MANUAL_RECEIPT : MANUAL_PAYMENT;
  if (!allowed.includes(b.category)) throw badRequest('Hạng mục thu/chi không hợp lệ');
  if (b.category === 'customer_debt' && !b.customer_id) throw badRequest('Chọn khách hàng cần thu nợ');
  if ((b.category === 'supplier_payment' || b.category === 'supplier_refund') && !b.supplier_id) throw badRequest('Chọn nhà cung cấp');
  const out = await db().tx(async (q) => {
    const code = await nextCode(q, b.tx_type === 'receipt' ? 'PT' : 'PC');
    const shift = b.method === 'cash' ? (await q.query(`SELECT id FROM cash_shifts WHERE user_id=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [req.user!.id])).rows[0] : null;
    const r = await q.query(`INSERT INTO cash_transactions(code, tx_type, category, method, amount, customer_id, supplier_id, shift_id, payer_name, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [code, b.tx_type, b.category, b.method, b.amount, b.customer_id ?? null, b.supplier_id ?? null, shift?.id ?? null, b.payer_name, b.note, req.user!.id]);
    await audit(req, 'create', 'cash_transaction', r.rows[0].id, `Lập ${b.tx_type === 'receipt' ? 'phiếu thu' : 'phiếu chi'} ${code}: ${b.amount.toLocaleString('vi-VN')}đ – ${CATEGORY_LABEL[b.category]}`, undefined, q);
    return r.rows[0];
  });
  res.json(out);
});
router.delete('/finance/transactions/:id', requirePerm('finance.edit'), async (req, res) => {
  const t = (await db().query(`SELECT * FROM cash_transactions WHERE id=$1`, [req.params.id])).rows[0];
  if (!t) throw notFound();
  if (t.ref_type) throw badRequest('Phiếu được sinh tự động từ đơn hàng/phiếu kho/sửa chữa – không thể xóa trực tiếp. Hãy hủy chứng từ gốc.');
  if (t.shift_id) {
    const s = (await db().query(`SELECT status FROM cash_shifts WHERE id=$1`, [t.shift_id])).rows[0];
    if (s?.status === 'closed') throw badRequest('Phiếu thuộc ca đã đóng, không thể xóa');
  }
  await db().query(`DELETE FROM cash_transactions WHERE id=$1`, [t.id]);
  await audit(req, 'delete', 'cash_transaction', t.id, `Xóa phiếu ${t.code} (${Number(t.amount).toLocaleString('vi-VN')}đ)`, t);
  res.json({ ok: true });
});

/** Tồn quỹ theo hình thức (tiền mặt / ngân hàng) trong kỳ */
router.get('/finance/summary', requirePerm('finance.view'), async (req, res) => {
  const qs = req.query as Record<string, string>;
  const from = qs.from || '1900-01-01';
  const to = qs.to || '2999-12-31';
  const fin = await getSetting<any>('finance', {});
  const rows = (await db().query(`SELECT method,
      coalesce(sum(CASE WHEN created_at < $1::date THEN (CASE WHEN tx_type='receipt' THEN amount ELSE -amount END) END),0) opening,
      coalesce(sum(CASE WHEN created_at >= $1::date AND created_at < $2::date + 1 AND tx_type='receipt' THEN amount END),0) receipt,
      coalesce(sum(CASE WHEN created_at >= $1::date AND created_at < $2::date + 1 AND tx_type='payment' THEN amount END),0) payment
      FROM cash_transactions GROUP BY method`, [from, to])).rows;
  const get = (m: string) => {
    const r = rows.find((x: any) => x.method === m) ?? { opening: 0, receipt: 0, payment: 0 };
    const openingBase = m === 'cash' ? Number(fin.opening_cash ?? 0) : m === 'transfer' ? Number(fin.opening_bank ?? 0) : 0;
    const opening = Number(r.opening) + openingBase;
    return { opening, receipt: Number(r.receipt), payment: Number(r.payment), closing: opening + Number(r.receipt) - Number(r.payment) };
  };
  res.json({ cash: get('cash'), transfer: get('transfer'), card: get('card') });
});

router.get('/finance/debts', requirePerm('finance.view'), async (_req, res) => {
  const customers = (await db().query(`SELECT * FROM (SELECT c.id, c.code, c.name, c.phone, (${customerDebtSql}) debt FROM customers c) x WHERE debt <> 0 ORDER BY debt DESC`)).rows;
  const suppliers = (await db().query(`SELECT * FROM (SELECT s.id, s.code, s.name, s.phone, (s.opening_debt
      + coalesce((SELECT sum(total_amount) FROM stock_documents d WHERE d.supplier_id=s.id AND d.doc_type='import' AND d.status='completed'),0)
      - coalesce((SELECT sum(amount) FROM cash_transactions c WHERE c.supplier_id=s.id AND c.tx_type='payment' AND c.category='supplier_payment'),0)
      + coalesce((SELECT sum(amount) FROM cash_transactions c WHERE c.supplier_id=s.id AND c.tx_type='receipt' AND c.category='supplier_refund'),0)) debt FROM suppliers s) x
      WHERE debt <> 0 ORDER BY debt DESC`)).rows;
  const consign = (await db().query(`SELECT coalesce(sum(consignment_price),0) s, count(*) n FROM product_serials WHERE is_consignment AND status='sold' AND consignment_settled_at IS NULL`)).rows[0];
  res.json({ customers, suppliers, consignment_payable: consign.s, consignment_count: consign.n });
});

// ======================================================================== BÁO CÁO
function range(req: Request) {
  const qs = req.query as Record<string, string>;
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  return { from: qs.from || today.slice(0, 8) + '01', to: qs.to || today };
}

async function pnl(from: string, to: string) {
  const s = (await db().query(`SELECT count(*) orders, coalesce(sum(subtotal + item_discount),0) gross_sales, coalesce(sum(item_discount + discount_amount + promotion_amount),0) discounts,
      coalesce(sum(total),0) sales, coalesce(sum(cost_total),0) cogs
      FROM orders WHERE status<>'cancelled' AND created_at >= $1::date AND created_at < $2::date + 1`, [from, to])).rows[0];
  const r = (await db().query(`SELECT coalesce(sum(refund_amount),0) refunds, coalesce(sum(cost_amount),0) cost_back FROM order_returns r JOIN orders o ON o.id=r.order_id
      WHERE o.status<>'cancelled' AND r.created_at >= $1::date AND r.created_at < $2::date + 1`, [from, to])).rows[0];
  const ex = (await db().query(`SELECT category, tx_type, sum(amount) amount FROM cash_transactions WHERE created_at >= $1::date AND created_at < $2::date + 1 GROUP BY category, tx_type`, [from, to])).rows;
  const repairParts = (await db().query(`SELECT coalesce(sum(rp.quantity*rp.unit_cost),0) s FROM repair_parts rp JOIN repair_tickets t ON t.id=rp.ticket_id
      WHERE t.status='delivered' AND t.delivered_at >= $1::date AND t.delivered_at < $2::date + 1`, [from, to])).rows[0].s;
  const netRevenue = Number(s.sales) - Number(r.refunds);
  const cogs = Number(s.cogs) - Number(r.cost_back);
  const grossProfit = netRevenue - cogs;
  const expenses = ex.filter((x: any) => x.tx_type === 'payment' && EXPENSE_CATEGORIES.includes(x.category)).map((x: any) => ({ category: x.category, label: CATEGORY_LABEL[x.category], amount: Number(x.amount) }));
  const otherIncome = ex.filter((x: any) => x.tx_type === 'receipt' && OTHER_INCOME_CATEGORIES.includes(x.category)).map((x: any) => ({ category: x.category, label: CATEGORY_LABEL[x.category], amount: Number(x.amount) }));
  // Chi phí linh kiện trên phiếu sửa chỉ để tham khảo; chi phí thực tế ghi nhận qua phiếu chi "repair_cost" (tránh tính 2 lần)
  const totalExpense = expenses.reduce((a: number, x: any) => a + x.amount, 0);
  const totalOther = otherIncome.reduce((a: number, x: any) => a + x.amount, 0);
  const cashIn = ex.filter((x: any) => x.tx_type === 'receipt').reduce((a: number, x: any) => a + Number(x.amount), 0);
  const cashOut = ex.filter((x: any) => x.tx_type === 'payment').reduce((a: number, x: any) => a + Number(x.amount), 0);
  return {
    from, to, orders: Number(s.orders), gross_sales: Number(s.gross_sales), discounts: Number(s.discounts), sales: Number(s.sales), refunds: Number(r.refunds),
    net_revenue: netRevenue, cogs, gross_profit: grossProfit, gross_margin: netRevenue ? grossProfit / netRevenue : 0,
    expenses, repair_parts_cost: Number(repairParts), total_expense: totalExpense, other_income: otherIncome, total_other_income: totalOther,
    net_profit: grossProfit + totalOther - totalExpense,
    cash_in: cashIn, cash_out: cashOut, net_cash_flow: cashIn - cashOut,
    cash_flow: ex.map((x: any) => ({ ...x, amount: Number(x.amount), label: CATEGORY_LABEL[x.category] ?? x.category })),
  };
}

router.get('/reports/pnl', requirePerm('reports.view'), async (req, res) => {
  const { from, to } = range(req);
  res.json(await pnl(from, to));
});

const GROUPS: Record<string, { trunc: string; fmt: string; step: string }> = {
  day: { trunc: 'day', fmt: 'DD/MM', step: '1 day' }, week: { trunc: 'week', fmt: '"T"IW/IYYY', step: '1 week' },
  month: { trunc: 'month', fmt: 'MM/YYYY', step: '1 month' }, year: { trunc: 'year', fmt: 'YYYY', step: '1 year' },
};
async function revenueSeries(from: string, to: string, group: string) {
  const g = GROUPS[group] ?? GROUPS.day;
  return (await db().query(`
    WITH periods AS (SELECT generate_series(date_trunc('${g.trunc}', $1::date::timestamptz), date_trunc('${g.trunc}', $2::date::timestamptz), '${g.step}'::interval) p),
    s AS (SELECT date_trunc('${g.trunc}', created_at) p, count(*) orders, sum(total) sales, sum(cost_total) cogs FROM orders
          WHERE status<>'cancelled' AND created_at >= $1::date AND created_at < $2::date + 1 GROUP BY 1),
    r AS (SELECT date_trunc('${g.trunc}', r.created_at) p, sum(refund_amount) refunds, sum(cost_amount) cost_back FROM order_returns r JOIN orders o ON o.id=r.order_id
          WHERE o.status<>'cancelled' AND r.created_at >= $1::date AND r.created_at < $2::date + 1 GROUP BY 1)
    SELECT to_char(periods.p, '${g.fmt}') label, periods.p::date period, coalesce(s.orders,0) orders, coalesce(s.sales,0) sales, coalesce(r.refunds,0) refunds,
      coalesce(s.sales,0) - coalesce(r.refunds,0) net_revenue, coalesce(s.cogs,0) - coalesce(r.cost_back,0) cogs,
      coalesce(s.sales,0) - coalesce(r.refunds,0) - (coalesce(s.cogs,0) - coalesce(r.cost_back,0)) gross_profit
    FROM periods LEFT JOIN s ON s.p=periods.p LEFT JOIN r ON r.p=periods.p ORDER BY periods.p`, [from, to])).rows;
}

router.get('/reports/revenue', requirePerm('reports.view'), async (req, res) => {
  const { from, to } = range(req);
  const group = String(req.query.group || 'day');
  const rows = await revenueSeries(from, to, group);
  if (req.query.format === 'xlsx') return sendExcel(res, `doanh-thu-${from}-${to}.xlsx`, 'Doanh thu', [
    { header: 'Kỳ', key: 'label' }, { header: 'Số đơn', key: 'orders' }, { header: 'Doanh số', key: 'sales', money: true }, { header: 'Trả hàng', key: 'refunds', money: true },
    { header: 'Doanh thu thuần', key: 'net_revenue', money: true }, { header: 'Giá vốn', key: 'cogs', money: true }, { header: 'Lợi nhuận gộp', key: 'gross_profit', money: true },
  ], rows);
  res.json(rows);
});

const productProfitSql = `
  SELECT p.id, p.sku, p.name, b.name brand_name,
    sum(i.quantity - i.returned_qty) qty,
    round(sum(i.line_total * (i.quantity - i.returned_qty)::numeric / i.quantity * CASE WHEN o.subtotal > 0 THEN o.total::numeric / o.subtotal ELSE 0 END)) revenue,
    sum(i.unit_cost * (i.quantity - i.returned_qty)) cost
  FROM order_items i JOIN orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id LEFT JOIN brands b ON b.id=p.brand_id
  WHERE o.status<>'cancelled' AND o.created_at >= $1::date AND o.created_at < $2::date + 1 AND i.quantity > i.returned_qty
  GROUP BY p.id, p.sku, p.name, b.name`;

router.get('/reports/products', requirePerm('reports.view'), async (req, res) => {
  const { from, to } = range(req);
  const sort = req.query.sort === 'qty' ? 'qty DESC' : req.query.sort === 'revenue' ? 'revenue DESC' : 'profit DESC';
  const rows = (await db().query(`SELECT *, revenue - cost profit, CASE WHEN revenue>0 THEN (revenue-cost)::float/revenue ELSE 0 END margin FROM (${productProfitSql}) x ORDER BY ${sort} LIMIT 500`, [from, to])).rows;
  if (req.query.format === 'xlsx') return sendExcel(res, `loi-nhuan-san-pham-${from}-${to}.xlsx`, 'Lợi nhuận SP', [
    { header: 'SKU', key: 'sku' }, { header: 'Sản phẩm', key: 'name', width: 36 }, { header: 'Thương hiệu', key: 'brand_name', width: 16 }, { header: 'SL bán', key: 'qty' },
    { header: 'Doanh thu', key: 'revenue', money: true }, { header: 'Giá vốn', key: 'cost', money: true }, { header: 'Lợi nhuận gộp', key: 'profit', money: true }, { header: 'Biên LN (%)', key: 'pct' },
  ], rows.map((r: any) => ({ ...r, pct: Math.round(r.margin * 1000) / 10 })));
  res.json(rows);
});

router.get('/reports/brands', requirePerm('reports.view'), async (req, res) => {
  const { from, to } = range(req);
  const rows = (await db().query(`SELECT coalesce(brand_name,'(Không thương hiệu)') brand_name, sum(qty) qty, sum(revenue) revenue, sum(cost) cost, sum(revenue - cost) profit
      FROM (${productProfitSql}) x GROUP BY brand_name ORDER BY revenue DESC`, [from, to])).rows;
  if (req.query.format === 'xlsx') return sendExcel(res, `thuong-hieu-${from}-${to}.xlsx`, 'Thương hiệu', [
    { header: 'Thương hiệu', key: 'brand_name', width: 20 }, { header: 'SL bán', key: 'qty' }, { header: 'Doanh thu', key: 'revenue', money: true },
    { header: 'Giá vốn', key: 'cost', money: true }, { header: 'Lợi nhuận gộp', key: 'profit', money: true },
  ], rows);
  res.json(rows);
});

router.get('/reports/inventory', requirePerm('reports.view', 'inventory.view'), async (req, res) => {
  const rows = (await db().query(`SELECT p.id, p.sku, p.name, p.track_serial, b.name brand_name, p.cost_price, p.sale_price,
      coalesce((SELECT sum(quantity) FROM stock_levels s WHERE s.product_id=p.id),0) qty,
      coalesce((SELECT sum(cost_price) FROM product_serials ps WHERE ps.product_id=p.id AND ps.status='in_stock' AND NOT ps.is_consignment),0) serial_cost,
      (SELECT count(*) FROM product_serials ps WHERE ps.product_id=p.id AND ps.status='in_stock' AND ps.is_consignment) consign_qty,
      (SELECT count(*) FROM product_serials ps WHERE ps.product_id=p.id AND ps.status='repairing') repairing_qty
      FROM products p LEFT JOIN brands b ON b.id=p.brand_id WHERE p.is_active ORDER BY p.name`)).rows
    .map((r: any) => {
      // Giá trị tồn: hàng serial dùng giá vốn thực tế từng chiếc, hàng thường dùng giá vốn bình quân
      const value = r.track_serial ? Number(r.serial_cost) : Number(r.qty) * Number(r.cost_price);
      return { ...r, stock_value: value, retail_value: Number(r.qty) * Number(r.sale_price) };
    }).filter((r: any) => r.qty > 0 || r.repairing_qty > 0);
  const showCost = hasPerm(req.user, 'products.cost');
  if (req.query.format === 'xlsx') {
    const cols: Col[] = [{ header: 'SKU', key: 'sku' }, { header: 'Sản phẩm', key: 'name', width: 36 }, { header: 'Thương hiệu', key: 'brand_name', width: 16 }, { header: 'Tồn', key: 'qty' },
      { header: 'Ký gửi', key: 'consign_qty' }, { header: 'Đang sửa', key: 'repairing_qty' }];
    if (showCost) cols.push({ header: 'Giá trị tồn (giá vốn)', key: 'stock_value', money: true });
    cols.push({ header: 'Giá trị theo giá bán', key: 'retail_value', money: true });
    return sendExcel(res, 'ton-kho.xlsx', 'Tồn kho', cols, rows);
  }
  res.json(showCost ? rows : rows.map((r: any) => ({ ...r, stock_value: undefined, cost_price: undefined, serial_cost: undefined })));
});

router.get('/reports/staff', requirePerm('reports.view'), async (req, res) => {
  const { from, to } = range(req);
  const rows = (await db().query(`SELECT u.id, u.full_name, r.name role_name,
      count(o.id) orders, coalesce(sum(o.total - o.refunded_amount),0) revenue, coalesce(sum(o.total - o.refunded_amount - o.cost_total),0) profit_est,
      (SELECT count(*) FROM orders x WHERE x.created_by=u.id AND x.status='cancelled' AND x.created_at >= $1::date AND x.created_at < $2::date + 1) cancelled,
      (SELECT coalesce(sum(work_minutes),0) FROM attendance_records a WHERE a.user_id=u.id AND a.work_date BETWEEN $1::date AND $2::date) work_minutes,
      (SELECT count(*) FROM attendance_records a WHERE a.user_id=u.id AND a.work_date BETWEEN $1::date AND $2::date AND a.late_minutes>0) late_days
      FROM users u JOIN roles r ON r.id=u.role_id
      LEFT JOIN orders o ON o.created_by=u.id AND o.status<>'cancelled' AND o.created_at >= $1::date AND o.created_at < $2::date + 1
      GROUP BY u.id, u.full_name, r.name ORDER BY revenue DESC`, [from, to])).rows;
  if (req.query.format === 'xlsx') return sendExcel(res, `nhan-vien-${from}-${to}.xlsx`, 'Nhân viên', [
    { header: 'Nhân viên', key: 'full_name', width: 22 }, { header: 'Vai trò', key: 'role_name', width: 18 }, { header: 'Số đơn', key: 'orders' },
    { header: 'Doanh thu', key: 'revenue', money: true }, { header: 'Đơn hủy', key: 'cancelled' }, { header: 'Giờ làm', key: 'hours' }, { header: 'Số ngày đi muộn', key: 'late_days' },
  ], rows.map((r: any) => ({ ...r, hours: Math.round(r.work_minutes / 6) / 10 })));
  res.json(rows);
});

router.get('/reports/customers', requirePerm('reports.view'), async (req, res) => {
  const { from, to } = range(req);
  const rows = (await db().query(`SELECT c.id, c.code, c.name, c.phone, c.customer_group, count(o.id) orders, sum(o.total - o.refunded_amount) revenue, max(o.created_at) last_order
      FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.status<>'cancelled' AND o.created_at >= $1::date AND o.created_at < $2::date + 1
      GROUP BY c.id ORDER BY revenue DESC LIMIT 200`, [from, to])).rows;
  if (req.query.format === 'xlsx') return sendExcel(res, `khach-hang-mua-nhieu-${from}-${to}.xlsx`, 'Khách hàng', [
    { header: 'Mã KH', key: 'code' }, { header: 'Khách hàng', key: 'name', width: 24 }, { header: 'SĐT', key: 'phone', width: 14 }, { header: 'Số đơn', key: 'orders' },
    { header: 'Doanh thu', key: 'revenue', money: true },
  ], rows);
  res.json(rows);
});

router.get('/reports/dashboard', requirePerm('dashboard.view'), async (req, res) => {
  const { from, to } = range(req);
  const group = String(req.query.group || 'day');
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const [todayP, monthP, periodP] = await Promise.all([pnl(today, today), pnl(monthStart, today), pnl(from, to)]);
  const stock = (await db().query(`SELECT coalesce(sum(quantity),0) qty FROM stock_levels`)).rows[0].qty;
  const stockValue = (await db().query(`SELECT coalesce(sum(CASE WHEN p.track_serial THEN (SELECT coalesce(sum(cost_price),0) FROM product_serials ps WHERE ps.product_id=p.id AND ps.status='in_stock' AND NOT ps.is_consignment)
      ELSE (SELECT coalesce(sum(quantity),0) FROM stock_levels s WHERE s.product_id=p.id) * p.cost_price END),0) v FROM products p`)).rows[0].v;
  const customers = (await db().query(`SELECT count(*) c, count(*) FILTER (WHERE created_at >= $1::date) new_c FROM customers`, [monthStart])).rows[0];
  const top = (await db().query(`SELECT *, revenue - cost profit FROM (${productProfitSql}) x ORDER BY qty DESC, revenue DESC LIMIT 8`, [from, to])).rows;
  const cfg = await getSetting<any>('inventory', {});
  const aging = (await db().query(`SELECT ps.serial_number, p.id product_id, p.name, p.sku, p.sale_price, (now()::date - ps.received_at::date) days
      FROM product_serials ps JOIN products p ON p.id=ps.product_id WHERE ps.status='in_stock' ORDER BY ps.received_at LIMIT 8`)).rows;
  const latest = (await db().query(`SELECT o.id, o.code, o.total, o.status, o.created_at, c.name customer_name, u.full_name created_by_name
      FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.created_by ORDER BY o.id DESC LIMIT 8`)).rows;
  const counts = (await db().query(`SELECT
      (SELECT count(*) FROM repair_tickets WHERE status NOT IN ('delivered','cancelled')) open_repairs,
      (SELECT count(*) FROM maintenance_reminders WHERE status='pending' AND due_date <= current_date + 30) due_reminders,
      (SELECT count(*) FROM products p WHERE p.is_active AND coalesce((SELECT sum(quantity) FROM stock_levels s WHERE s.product_id=p.id),0) <= p.min_stock) low_stock,
      (SELECT count(*) FROM product_serials WHERE status='in_stock' AND received_at < now() - ($1 || ' days')::interval) aging_count,
      (SELECT count(*) FROM product_serials WHERE status='repairing') repairing,
      (SELECT count(*) FROM warranties WHERE status='active' AND end_date BETWEEN current_date AND current_date + 30) expiring_warranties`, [String(Number(cfg.aging_days) || 180)])).rows[0];
  const showCost = hasPerm(req.user, 'products.cost');
  res.json({
    today: { revenue: todayP.net_revenue, orders: todayP.orders, gross_profit: showCost ? todayP.gross_profit : null },
    month: { revenue: monthP.net_revenue, orders: monthP.orders, gross_profit: showCost ? monthP.gross_profit : null },
    period: { revenue: periodP.net_revenue, orders: periodP.orders, gross_profit: showCost ? periodP.gross_profit : null, net_profit: showCost ? periodP.net_profit : null, cogs: showCost ? periodP.cogs : null },
    stock_qty: stock, stock_value: showCost ? stockValue : null,
    customers: customers.c, new_customers: customers.new_c,
    chart: (await revenueSeries(from, to, group)).map((r: any) => (showCost ? r : { ...r, cogs: undefined, gross_profit: undefined })),
    top_products: top.map((r: any) => (showCost ? r : { ...r, cost: undefined, profit: undefined })),
    aging, latest_orders: latest, counts,
  });
});

/**
 * Nghiệp vụ kho. Mọi thay đổi tồn kho đi qua postMovement() → stock_movements (sổ cái bất biến).
 */
import { z } from 'zod';
import { nextCode, type Queryable } from '../db.ts';
import { badRequest, postMovement, zOptStr } from '../core.ts';

export const DOC_PREFIX: Record<string, string> = {
  import: 'PN', export: 'PX', transfer: 'CK', stocktake: 'KK', adjust: 'DC',
  consign_in: 'KG', consign_return: 'TKG', repair_out: 'SC', repair_in: 'NSC',
};
export const DOC_LABEL: Record<string, string> = {
  import: 'Nhập hàng', export: 'Xuất hàng', transfer: 'Chuyển kho', stocktake: 'Kiểm kê', adjust: 'Điều chỉnh tồn',
  consign_in: 'Nhận ký gửi', consign_return: 'Trả hàng ký gửi', repair_out: 'Gửi sửa chữa', repair_in: 'Nhận về từ sửa chữa',
};

const serialInput = z.object({
  serial_number: z.string().trim().min(1, 'Serial không được trống').max(100),
  movement_number: zOptStr,
  condition: z.enum(['new', 'used', 'repaired']).optional(),
  note: zOptStr,
});

export const stockDocSchema = z.object({
  doc_type: z.enum(['import', 'export', 'transfer', 'stocktake', 'adjust', 'consign_in', 'consign_return', 'repair_out', 'repair_in']),
  warehouse_id: z.coerce.number().int().positive('Chọn kho'),
  to_warehouse_id: z.coerce.number().int().positive().optional().nullable(),
  supplier_id: z.coerce.number().int().positive().optional().nullable(),
  reason: zOptStr,
  note: zOptStr,
  paid_amount: z.coerce.number().int().min(0).default(0),
  payment_method: z.enum(['cash', 'transfer']).default('cash'),
  consignor_name: zOptStr,
  consignor_phone: zOptStr,
  created_at: z.string().optional(), // chỉ dùng nội bộ (dữ liệu mẫu)
  items: z.array(z.object({
    product_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().default(0),
    unit_cost: z.coerce.number().int().min(0).default(0),
    serials: z.array(serialInput).default([]),
    serial_ids: z.array(z.coerce.number().int().positive()).default([]),
    counted_qty: z.coerce.number().int().min(0).optional(),
    note: zOptStr,
  })).min(1, 'Phiếu phải có ít nhất 1 sản phẩm'),
});
export type StockDocInput = z.infer<typeof stockDocSchema>;

async function getProduct(q: Queryable, id: number) {
  const r = await q.query(`SELECT * FROM products WHERE id=$1`, [id]);
  if (!r.rows[0]) throw badRequest(`Sản phẩm #${id} không tồn tại`);
  return r.rows[0];
}

async function getSerials(q: Queryable, ids: number[], productId: number) {
  if (!ids.length) return [];
  const r = await q.query(`SELECT * FROM product_serials WHERE id = ANY($1::int[]) FOR UPDATE`, [ids]);
  if (r.rows.length !== new Set(ids).size) throw badRequest('Có serial không tồn tại');
  for (const s of r.rows) if (s.product_id !== productId) throw badRequest(`Serial ${s.serial_number} không thuộc sản phẩm đã chọn`);
  return r.rows;
}

async function currentQty(q: Queryable, productId: number, warehouseId: number) {
  const r = await q.query(`SELECT quantity FROM stock_levels WHERE product_id=$1 AND warehouse_id=$2`, [productId, warehouseId]);
  return (r.rows[0]?.quantity as number) ?? 0;
}

/** Cập nhật giá vốn bình quân gia quyền khi nhập hàng */
async function updateAvgCost(q: Queryable, product: any, addQty: number, unitCost: number, userId: number | null, code: string) {
  const totalR = await q.query(`SELECT coalesce(sum(quantity),0) qty FROM stock_levels WHERE product_id=$1`, [product.id]);
  const oldQty = Math.max(0, Number(totalR.rows[0].qty) - addQty); // tồn trước khi nhập
  const newCost = oldQty + addQty > 0
    ? Math.round((oldQty * Number(product.cost_price) + addQty * unitCost) / (oldQty + addQty))
    : unitCost;
  if (newCost !== Number(product.cost_price)) {
    await q.query(`INSERT INTO product_price_history(product_id, field, old_value, new_value, user_id, reason) VALUES ($1,'cost_price',$2,$3,$4,$5)`,
      [product.id, product.cost_price, newCost, userId, `Bình quân sau ${code}`]);
  }
  if (unitCost !== Number(product.purchase_price)) {
    await q.query(`INSERT INTO product_price_history(product_id, field, old_value, new_value, user_id, reason) VALUES ($1,'purchase_price',$2,$3,$4,$5)`,
      [product.id, product.purchase_price, unitCost, userId, `Nhập hàng ${code}`]);
  }
  await q.query(`UPDATE products SET cost_price=$2, purchase_price=$3, updated_at=now() WHERE id=$1`, [product.id, newCost, unitCost]);
}

export async function createStockDocument(q: Queryable, input: StockDocInput, userId: number | null) {
  const d = input;
  const type = d.doc_type;
  if (type === 'transfer') {
    if (!d.to_warehouse_id) throw badRequest('Chọn kho nhận');
    if (d.to_warehouse_id === d.warehouse_id) throw badRequest('Kho nhận phải khác kho xuất');
  }
  if (type === 'consign_in' && !d.consignor_name) throw badRequest('Nhập tên người/đơn vị ký gửi');
  const wh = await q.query(`SELECT id FROM warehouses WHERE id = ANY($1::int[])`, [[d.warehouse_id, d.to_warehouse_id].filter(Boolean)]);
  if (wh.rows.length !== [d.warehouse_id, d.to_warehouse_id].filter(Boolean).length) throw badRequest('Kho không tồn tại');

  const code = await nextCode(q, DOC_PREFIX[type]);
  const createdAt = d.created_at || new Date().toISOString();
  const doc = (await q.query(
    `INSERT INTO stock_documents(code, doc_type, warehouse_id, to_warehouse_id, supplier_id, reason, note, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [code, type, d.warehouse_id, d.to_warehouse_id ?? null, d.supplier_id ?? null, d.reason, d.note, userId, createdAt],
  )).rows[0];

  let total = 0;
  const mv = (x: Omit<Parameters<typeof postMovement>[1], 'ref_type'>) =>
    postMovement(q, { ...x, ref_type: type, ref_id: doc.id, ref_code: code, user_id: userId });
  const addItem = (productId: number, serialId: number | null, qty: number, cost: number, extra: { system_qty?: number; counted_qty?: number; note?: string | null } = {}) =>
    q.query(`INSERT INTO stock_document_items(document_id, product_id, serial_id, quantity, unit_cost, system_qty, counted_qty, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [doc.id, productId, serialId, qty, cost, extra.system_qty ?? null, extra.counted_qty ?? null, extra.note ?? null]);

  for (const it of d.items) {
    const p = await getProduct(q, it.product_id);
    const label = `${p.sku} – ${p.name}`;

    if (type === 'import' || type === 'consign_in') {
      const isConsign = type === 'consign_in';
      if (p.track_serial) {
        if (!it.serials.length) throw badRequest(`${label}: cần nhập Serial Number cho từng chiếc`);
        const dup = it.serials.map((s) => s.serial_number.toUpperCase()).filter((s, i, a) => a.indexOf(s) !== i);
        if (dup.length) throw badRequest(`${label}: serial bị trùng trong phiếu (${dup[0]})`);
        for (const s of it.serials) {
          const ex = await q.query(`SELECT id FROM product_serials WHERE upper(serial_number)=upper($1)`, [s.serial_number]);
          if (ex.rows.length) throw badRequest(`Serial "${s.serial_number}" đã tồn tại trong hệ thống`);
          const sr = (await q.query(
            `INSERT INTO product_serials(product_id, serial_number, movement_number, condition, cost_price, warehouse_id, status,
               is_consignment, consignor_name, consignor_phone, consignment_price, supplier_id, received_at, note)
             VALUES ($1,$2,$3,$4,$5,$6,'in_stock',$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
            [p.id, s.serial_number.trim(), s.movement_number, s.condition || p.condition, it.unit_cost, d.warehouse_id,
             isConsign, isConsign ? d.consignor_name : null, isConsign ? d.consignor_phone : null, isConsign ? it.unit_cost : null,
             d.supplier_id ?? null, createdAt, s.note],
          )).rows[0];
          await mv({ product_id: p.id, warehouse_id: d.warehouse_id, serial_id: sr.id, qty_change: 1, unit_cost: it.unit_cost, note: s.serial_number });
          await addItem(p.id, sr.id, 1, it.unit_cost);
        }
        if (!isConsign) await updateAvgCost(q, p, it.serials.length, it.unit_cost, userId, code);
        total += it.serials.length * it.unit_cost;
      } else {
        if (it.quantity <= 0) throw badRequest(`${label}: số lượng nhập phải > 0`);
        await mv({ product_id: p.id, warehouse_id: d.warehouse_id, qty_change: it.quantity, unit_cost: it.unit_cost });
        await addItem(p.id, null, it.quantity, it.unit_cost);
        if (!isConsign) await updateAvgCost(q, p, it.quantity, it.unit_cost, userId, code);
        total += it.quantity * it.unit_cost;
      }
      continue;
    }

    if (type === 'export' || type === 'consign_return' || type === 'repair_out' || type === 'transfer') {
      if (p.track_serial) {
        if (!it.serial_ids.length) throw badRequest(`${label}: chọn serial cần ${DOC_LABEL[type].toLowerCase()}`);
        const serials = await getSerials(q, it.serial_ids, p.id);
        for (const s of serials) {
          if (s.status !== 'in_stock') throw badRequest(`Serial ${s.serial_number} không còn trong kho`);
          if (s.warehouse_id !== d.warehouse_id) throw badRequest(`Serial ${s.serial_number} không nằm ở kho đã chọn`);
          if (type === 'consign_return' && !s.is_consignment) throw badRequest(`Serial ${s.serial_number} không phải hàng ký gửi`);
          const cost = Number(s.cost_price);
          await mv({ product_id: p.id, warehouse_id: d.warehouse_id, serial_id: s.id, qty_change: -1, unit_cost: cost, note: s.serial_number });
          if (type === 'transfer') {
            await mv({ product_id: p.id, warehouse_id: d.to_warehouse_id!, serial_id: s.id, qty_change: 1, unit_cost: cost, note: s.serial_number });
            await q.query(`UPDATE product_serials SET warehouse_id=$2 WHERE id=$1`, [s.id, d.to_warehouse_id]);
          } else {
            const st = type === 'repair_out' ? 'repairing' : type === 'consign_return' ? 'returned_supplier' : 'exported';
            await q.query(`UPDATE product_serials SET status=$2 WHERE id=$1`, [s.id, st]);
          }
          await addItem(p.id, s.id, 1, cost);
          total += cost;
        }
      } else {
        if (it.quantity <= 0) throw badRequest(`${label}: số lượng phải > 0`);
        if (type === 'repair_out' || type === 'consign_return') throw badRequest(`${label}: chức năng này chỉ áp dụng cho sản phẩm quản lý serial`);
        const cost = Number(p.cost_price);
        await mv({ product_id: p.id, warehouse_id: d.warehouse_id, qty_change: -it.quantity, unit_cost: cost });
        if (type === 'transfer') await mv({ product_id: p.id, warehouse_id: d.to_warehouse_id!, qty_change: it.quantity, unit_cost: cost });
        await addItem(p.id, null, it.quantity, cost);
        total += it.quantity * cost;
      }
      continue;
    }

    if (type === 'repair_in') {
      if (!p.track_serial) throw badRequest(`${label}: chỉ áp dụng cho sản phẩm quản lý serial`);
      const serials = await getSerials(q, it.serial_ids, p.id);
      if (!serials.length) throw badRequest(`${label}: chọn serial nhận về`);
      for (const s of serials) {
        if (s.status !== 'repairing') throw badRequest(`Serial ${s.serial_number} không ở trạng thái đang sửa chữa`);
        await mv({ product_id: p.id, warehouse_id: d.warehouse_id, serial_id: s.id, qty_change: 1, unit_cost: Number(s.cost_price), note: s.serial_number });
        await q.query(`UPDATE product_serials SET status='in_stock', warehouse_id=$2, condition=CASE WHEN condition='new' THEN 'new' ELSE 'repaired' END WHERE id=$1`, [s.id, d.warehouse_id]);
        await addItem(p.id, s.id, 1, Number(s.cost_price));
      }
      continue;
    }

    if (type === 'adjust') {
      if (p.track_serial) throw badRequest(`${label}: sản phẩm quản lý serial – hãy dùng Nhập hàng / Xuất hàng / Kiểm kê để điều chỉnh`);
      if (!it.quantity) throw badRequest(`${label}: số lượng điều chỉnh phải khác 0`);
      if (!d.reason) throw badRequest('Nhập lý do điều chỉnh');
      const cost = Number(p.cost_price);
      await mv({ product_id: p.id, warehouse_id: d.warehouse_id, qty_change: it.quantity, unit_cost: cost, note: d.reason });
      await addItem(p.id, null, it.quantity, cost);
      total += it.quantity * cost;
      continue;
    }

    if (type === 'stocktake') {
      const sys = await currentQty(q, p.id, d.warehouse_id);
      if (p.track_serial) {
        // serial_ids = các serial quét/đếm được; serial còn lại trong kho bị coi là thiếu
        const inStock = (await q.query(`SELECT * FROM product_serials WHERE product_id=$1 AND warehouse_id=$2 AND status='in_stock' FOR UPDATE`, [p.id, d.warehouse_id])).rows;
        const found = new Set(it.serial_ids);
        const unknown = it.serial_ids.filter((id) => !inStock.some((s: any) => s.id === id));
        if (unknown.length) throw badRequest(`${label}: có serial được đếm không thuộc tồn kho hiện tại – hãy dùng Nhập hàng`);
        const missing = inStock.filter((s: any) => !found.has(s.id));
        for (const s of missing) {
          await mv({ product_id: p.id, warehouse_id: d.warehouse_id, serial_id: s.id, qty_change: -1, unit_cost: Number(s.cost_price), note: `Thiếu khi kiểm kê: ${s.serial_number}` });
          await q.query(`UPDATE product_serials SET status='exported', note=coalesce(note||' | ','')||'Thiếu khi kiểm kê '||$2 WHERE id=$1`, [s.id, code]);
          total -= Number(s.cost_price);
        }
        await addItem(p.id, null, -missing.length, Number(p.cost_price), { system_qty: sys, counted_qty: it.serial_ids.length, note: missing.map((s: any) => s.serial_number).join(', ') || null });
      } else {
        if (it.counted_qty === undefined) throw badRequest(`${label}: nhập số lượng thực tế`);
        const diff = it.counted_qty - sys;
        if (diff !== 0) await mv({ product_id: p.id, warehouse_id: d.warehouse_id, qty_change: diff, unit_cost: Number(p.cost_price), note: `Kiểm kê: hệ thống ${sys}, thực tế ${it.counted_qty}` });
        await addItem(p.id, null, diff, Number(p.cost_price), { system_qty: sys, counted_qty: it.counted_qty });
        total += diff * Number(p.cost_price);
      }
      continue;
    }
  }

  // Công nợ nhà cung cấp & thanh toán khi nhập hàng
  let paid = 0;
  if (type === 'import') {
    paid = Math.min(d.paid_amount, total);
    if (paid > 0) {
      if (!d.supplier_id) throw badRequest('Chọn nhà cung cấp để ghi nhận thanh toán');
      const pc = await nextCode(q, 'PC');
      await q.query(
        `INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, supplier_id, note, created_by, created_at)
         VALUES ($1,'payment','supplier_payment',$2,$3,'stock_document',$4,$5,$6,$7,$8)`,
        [pc, d.payment_method, paid, doc.id, d.supplier_id, `Thanh toán phiếu nhập ${code}`, userId, createdAt],
      );
    }
  }
  await q.query(`UPDATE stock_documents SET total_amount=$2, paid_amount=$3 WHERE id=$1`, [doc.id, total, paid]);
  return { ...doc, total_amount: total, paid_amount: paid };
}

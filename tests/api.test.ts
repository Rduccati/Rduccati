/**
 * Kiểm thử nghiệp vụ end-to-end qua HTTP API trên database PostgreSQL nhúng trong bộ nhớ.
 * Chạy: npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

process.env.WATCHPOS_MEMORY_DB = '1';
process.env.WATCHPOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'watchpos-test-'));
process.env.JWT_SECRET = 'test-secret';

const { openDatabase, closeDatabase, db } = await import('../server/db.ts');
const { bootstrap, createApp } = await import('../server/app.ts');

let server: Server;
let base = '';
let admin = '';

async function call(method: string, url: string, body?: any, token = admin): Promise<{ status: number; data: any }> {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const ok = async (method: string, url: string, body?: any, token = admin): Promise<any> => {
  const r = await call(method, url, body, token);
  assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};

let wh = 0, product = 0, accessory = 0, serialIds: number[] = [];

before(async () => {
  await openDatabase({ memory: true });
  await bootstrap();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  admin = (await ok('POST', '/auth/login', { username: 'admin', password: 'admin123' }, '')).token;
  wh = (await ok('GET', '/warehouses'))[0].id;
});
after(async () => { server.close(); await closeDatabase(); });

test('đăng nhập sai bị từ chối, API yêu cầu token', async () => {
  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'sai' }, '')).status, 401);
  assert.equal((await call('GET', '/products', undefined, '')).status, 401);
});

test('tạo sản phẩm tự sinh SKU + barcode EAN-13 hợp lệ, có nhập tồn đầu bằng serial', async () => {
  const brand = await ok('POST', '/brands', { name: 'Seiko', country: 'Nhật Bản' });
  const p = await ok('POST', '/products', {
    name: 'Seiko Presage Cocktail', brand_id: brand.id, movement_type: 'automatic', sale_price: 12_500_000, purchase_price: 9_000_000,
    warranty_months: 24, track_serial: true, opening_stock: { warehouse_id: wh, unit_cost: 9_000_000, serials: [{ serial_number: 'SN-A1' }, { serial_number: 'SN-A2' }, { serial_number: 'SN-A3' }] },
  });
  product = p.id;
  assert.match(p.sku, /^SEI-\d{4}$/);
  assert.match(p.barcode, /^\d{13}$/);
  const detail = await ok('GET', `/products/${p.id}`);
  assert.equal(detail.stock_qty, 3);
  assert.equal(detail.serials.length, 3);
  assert.equal(detail.movements.length, 3, 'mỗi serial có 1 dòng sổ kho');
  serialIds = detail.serials.map((s: any) => s.id);
});

test('serial trùng bị chặn; barcode EAN-13 sai check digit bị chặn', async () => {
  const r = await call('POST', '/inventory/documents', { doc_type: 'import', warehouse_id: wh, items: [{ product_id: product, unit_cost: 1, serials: [{ serial_number: 'sn-a1' }] }] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /đã tồn tại/);
  const b = await call('POST', '/products', { name: 'Test EAN', sale_price: 1000, barcode: '2000000000011', barcode_type: 'EAN13' });
  assert.equal(b.status, 400);
});

test('tồn kho KHÔNG thể sửa trực tiếp – chỉ qua sổ cái; sổ cái bất biến', async () => {
  await assert.rejects(db().query(`UPDATE stock_levels SET quantity = 99`), /Không được thay đổi tồn kho trực tiếp/);
  await assert.rejects(db().query(`DELETE FROM stock_movements`), /bất biến/);
  await assert.rejects(db().query(`UPDATE stock_movements SET qty_change = 5`), /bất biến/);
});

test('phụ kiện không serial: nhập, điều chỉnh, kiểm kê; không cho xuất âm kho', async () => {
  const p = await ok('POST', '/products', { name: 'Pin Renata 371', sale_price: 80_000, purchase_price: 25_000, track_serial: false, barcode_type: 'CODE128', opening_stock: { warehouse_id: wh, quantity: 10, unit_cost: 25_000 } });
  accessory = p.id;
  const neg = await call('POST', '/inventory/documents', { doc_type: 'export', warehouse_id: wh, items: [{ product_id: accessory, quantity: 11 }] });
  assert.equal(neg.status, 400);
  assert.match(neg.data.error, /Tồn kho không đủ/);
  await ok('POST', '/inventory/documents', { doc_type: 'adjust', warehouse_id: wh, reason: 'Hỏng', items: [{ product_id: accessory, quantity: -1 }] });
  await ok('POST', '/inventory/documents', { doc_type: 'stocktake', warehouse_id: wh, items: [{ product_id: accessory, counted_qty: 7 }] });
  assert.equal((await ok('GET', `/products/${accessory}`)).stock_qty, 7);
});

test('bán hàng POS: tính tiền phía server, trừ kho, tạo bảo hành, phiếu thu, tiền thừa', async () => {
  const o = await ok('POST', '/orders', {
    warehouse_id: wh, items: [{ product_id: product, serial_id: serialIds[0], quantity: 1, unit_price: 12_500_000 }, { product_id: accessory, quantity: 2, unit_price: 80_000 }],
    discount_type: 'percent', discount_value: 10, payments: [{ method: 'transfer', amount: 5_000_000 }, { method: 'cash', amount: 7_000_000 }],
  });
  // subtotal 12.660.000, giảm 10% = 1.266.000 → 11.394.000; CK 5tr, TM cần 6.394.000, khách đưa 7tr → thừa 606.000
  assert.equal(o.total, 11_394_000);
  assert.equal(o.change_amount, 606_000);
  assert.equal(o.paid_amount, 11_394_000);
  const d = await ok('GET', `/orders/${o.id}`);
  assert.equal(d.warranties.length, 1);
  assert.equal(d.payments.reduce((s: number, p: any) => s + p.amount, 0), 11_394_000);
  assert.equal((await ok('GET', `/products/${product}`)).stock_qty, 2);
  assert.equal((await ok('GET', `/products/${accessory}`)).stock_qty, 5);
  // serial đã bán không thể bán lại
  const again = await call('POST', '/orders', { warehouse_id: wh, items: [{ product_id: product, serial_id: serialIds[0], quantity: 1 }], payments: [{ method: 'cash', amount: 99_999_999 }] });
  assert.equal(again.status, 400);
});

test('thanh toán thiếu bị chặn nếu không cho ghi nợ; bán nợ cần khách hàng', async () => {
  const r = await call('POST', '/orders', { warehouse_id: wh, items: [{ product_id: accessory, quantity: 1 }], payments: [{ method: 'cash', amount: 10_000 }] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /chưa đủ/);
  const r2 = await call('POST', '/orders', { warehouse_id: wh, items: [{ product_id: accessory, quantity: 1 }], payments: [], allow_debt: true });
  assert.match(r2.data.error, /chọn khách hàng/);
  const c = await ok('POST', '/customers', { name: 'Khách nợ', phone: '0909000111' });
  await ok('POST', '/orders', { customer_id: c.id, warehouse_id: wh, items: [{ product_id: accessory, quantity: 1 }], payments: [{ method: 'cash', amount: 30_000 }], allow_debt: true });
  assert.equal((await ok('GET', `/customers/${c.id}`)).debt, 50_000);
  await ok('POST', '/finance/transactions', { tx_type: 'receipt', category: 'customer_debt', method: 'cash', amount: 50_000, customer_id: c.id });
  assert.equal((await ok('GET', `/customers/${c.id}`)).debt, 0);
});

test('trả hàng: nhập lại kho, hoàn tiền phân bổ giảm giá, hủy bảo hành', async () => {
  const o = await ok('POST', '/orders', { warehouse_id: wh, items: [{ product_id: product, serial_id: serialIds[1], quantity: 1 }], discount_type: 'amount', discount_value: 500_000, payments: [{ method: 'cash', amount: 12_000_000 }] });
  const d = await ok('GET', `/orders/${o.id}`);
  const r = await ok('POST', `/orders/${o.id}/return`, { items: [{ order_item_id: d.items[0].id, quantity: 1 }], reason: 'Khách đổi ý' });
  assert.equal(r.refund_amount, 12_000_000);
  const after = await ok('GET', `/orders/${o.id}`);
  assert.equal(after.status, 'returned');
  assert.equal(after.warranties[0].status, 'void');
  const s = (await ok('GET', `/products/${product}`)).serials.find((x: any) => x.id === serialIds[1]);
  assert.equal(s.status, 'in_stock');
  assert.equal(s.condition, 'used', 'đồng hồ trả lại chuyển sang đã qua sử dụng');
});

test('hủy đơn: hoàn kho + phiếu chi hoàn tiền; doanh thu không tính đơn hủy', async () => {
  const before = await ok('GET', '/reports/pnl');
  const o = await ok('POST', '/orders', { warehouse_id: wh, items: [{ product_id: product, serial_id: serialIds[2], quantity: 1 }], payments: [{ method: 'cash', amount: 12_500_000 }] });
  await ok('POST', `/orders/${o.id}/cancel`, { reason: 'Nhập nhầm' });
  const after = await ok('GET', '/reports/pnl');
  assert.equal(after.net_revenue, before.net_revenue);
  assert.equal(after.net_cash_flow, before.net_cash_flow, 'thu rồi chi hoàn → dòng tiền ròng không đổi');
  assert.equal((await ok('GET', `/products/${product}`)).stock_qty, 2);
  assert.equal((await call('POST', `/orders/${o.id}/cancel`, { reason: 'x' })).status, 400, 'không hủy 2 lần');
});

test('báo cáo lãi lỗ: doanh thu ≠ lợi nhuận; chi phí trừ vào lợi nhuận ròng', async () => {
  const p0 = await ok('GET', '/reports/pnl');
  assert.equal(p0.gross_profit, p0.net_revenue - p0.cogs);
  await ok('POST', '/finance/transactions', { tx_type: 'payment', category: 'rent', method: 'transfer', amount: 1_000_000 });
  const p1 = await ok('GET', '/reports/pnl');
  assert.equal(p1.net_revenue, p0.net_revenue);
  assert.equal(p1.net_profit, p0.net_profit - 1_000_000);
});

test('phân quyền: nhân viên bán hàng không xem được giá vốn, không vào báo cáo / cài đặt', async () => {
  const roles = await ok('GET', '/roles');
  await ok('POST', '/users', { username: 'nv1', password: '123456', full_name: 'Nhân viên 1', role_id: roles.find((r: any) => r.code === 'sales').id, is_active: true });
  const t = (await ok('POST', '/auth/login', { username: 'nv1', password: '123456' }, '')).token;
  const p = await ok('GET', `/products/${product}`, undefined, t);
  assert.equal(p.cost_price, undefined);
  assert.equal(p.purchase_price, undefined);
  assert.equal((await call('GET', '/reports/pnl', undefined, t)).status, 403);
  assert.equal((await call('PUT', '/settings/store', { name: 'x' }, t)).status, 403);
  assert.equal((await call('POST', '/orders/1/cancel', { reason: 'x' }, t)).status, 403);
});

test('ca bán hàng: đối soát tiền mặt cuối ca', async () => {
  const s = await ok('POST', '/shifts/open', { opening_cash: 1_000_000 });
  await ok('POST', '/orders', { warehouse_id: wh, items: [{ product_id: accessory, quantity: 1 }], payments: [{ method: 'cash', amount: 100_000 }] });
  const closed = await ok('POST', `/shifts/${s.id}/close`, { counted_cash: 1_070_000 });
  assert.equal(closed.expected_cash, 1_080_000);
  assert.equal(closed.difference, -10_000);
});

test('sửa chữa: đặt cọc, giao khách thu phần còn lại', async () => {
  const r = await ok('POST', '/repairs', { customer_name: 'Anh Quang', customer_phone: '0906111333', issue: 'Thay kính', estimated_cost: 1_200_000, deposit: 300_000 });
  await ok('POST', `/repairs/${r.id}/parts`, { part_name: 'Kính sapphire', quantity: 1, unit_cost: 450_000, unit_price: 900_000 });
  const x = await ok('POST', `/repairs/${r.id}/status`, { status: 'delivered', final_cost: 1_200_000 });
  assert.equal(x.collected, 900_000);
  assert.equal((await call('POST', `/repairs/${r.id}/status`, { status: 'repairing' })).status, 400);
});

test('sao lưu & khôi phục giữ nguyên dữ liệu và sổ kho', async () => {
  const dumpRes = await fetch(base + '/backup/download', { headers: { Authorization: 'Bearer ' + admin } });
  const dump: any = await dumpRes.json();
  const before = (await ok('GET', `/products/${product}`)).stock_qty;
  await ok('POST', '/inventory/documents', { doc_type: 'adjust', warehouse_id: wh, reason: 'test', items: [{ product_id: accessory, quantity: 5 }] });
  const fd = new FormData();
  fd.append('file', new Blob([JSON.stringify(dump)], { type: 'application/json' }), 'b.json');
  const rr = await fetch(base + '/backup/restore', { method: 'POST', headers: { Authorization: 'Bearer ' + admin }, body: fd });
  assert.equal(rr.status, 200, await rr.text());
  admin = (await ok('POST', '/auth/login', { username: 'admin', password: 'admin123' }, '')).token;
  assert.equal((await ok('GET', `/products/${product}`)).stock_qty, before);
  assert.equal((await ok('GET', `/products/${accessory}`)).stock_qty, dump.tables.stock_movements.filter((m: any) => m.product_id === accessory).reduce((s: number, m: any) => s + m.qty_change, 0));
  // tạo mới sau khôi phục không bị trùng khóa
  await ok('POST', '/customers', { name: 'Sau khôi phục' });
});

test('xóa dữ liệu kinh doanh giữ lại tài khoản & cài đặt', async () => {
  assert.equal((await call('POST', '/system/clear-business-data', { confirm: 'sai' })).status, 400);
  await ok('POST', '/system/clear-business-data', { confirm: 'XOA DU LIEU' });
  assert.equal((await ok('GET', '/products')).total, 0);
  assert.equal((await ok('GET', '/orders')).total, 0);
  assert.ok((await ok('GET', '/users')).length >= 2);
});

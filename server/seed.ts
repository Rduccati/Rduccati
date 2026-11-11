/**
 * Dữ liệu mẫu để kiểm tra toàn bộ hệ thống. Tạo thông qua chính các nghiệp vụ thật (phiếu nhập, đơn hàng...)
 * nên sổ kho / thu chi luôn khớp. Có thể xóa trong Cài đặt → Dữ liệu → "Xóa dữ liệu mẫu".
 */
import bcrypt from 'bcryptjs';
import { db, nextCode, openDatabase } from './db.ts';
import { createStockDocument } from './services/inventory.ts';
import { createOrder, returnOrder, cancelOrder } from './services/sales.ts';
import { generateBarcode } from './routes/products.ts';

let seed = 20261111;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const daysAgo = (d: number, hour = 10, min = 0) => {
  const t = new Date(Date.now() - d * 86400_000);
  const ymd = new Date(t.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+07:00`).toISOString();
};

const BRANDS = [['Rolex', 'Thụy Sĩ'], ['Omega', 'Thụy Sĩ'], ['Longines', 'Thụy Sĩ'], ['Tissot', 'Thụy Sĩ'], ['Hamilton', 'Thụy Sĩ'], ['Seiko', 'Nhật Bản'], ['Citizen', 'Nhật Bản'], ['Orient', 'Nhật Bản'], ['Casio', 'Nhật Bản']];

const PRODUCTS: any[] = [
  { name: 'Rolex Submariner Date 41mm', brand: 'Rolex', model: 'Submariner', ref: '126610LN', mv: 'automatic', d: 41, cm: 'Thép Oystersteel', sm: 'Dây Oyster thép', buy: 245000000, sale: 310000000, w: 60, n: 2, ago: 200 },
  { name: 'Rolex Datejust 36 Mặt xanh', brand: 'Rolex', model: 'Datejust', ref: '126234', mv: 'automatic', d: 36, cm: 'Thép & vàng trắng', sm: 'Dây Jubilee', buy: 215000000, sale: 268000000, w: 60, n: 2, ago: 95 },
  { name: 'Omega Seamaster Diver 300M', brand: 'Omega', model: 'Seamaster', ref: '210.30.42.20.03.001', mv: 'automatic', d: 42, cm: 'Thép không gỉ', sm: 'Dây thép', buy: 118000000, sale: 152000000, w: 60, n: 3, ago: 120 },
  { name: 'Omega Speedmaster Moonwatch', brand: 'Omega', model: 'Speedmaster', ref: '310.30.42.50.01.001', mv: 'mechanical', d: 42, cm: 'Thép không gỉ', sm: 'Dây thép', buy: 142000000, sale: 178000000, w: 60, n: 2, ago: 260 },
  { name: 'Longines Master Collection', brand: 'Longines', model: 'Master Collection', ref: 'L2.793.4.78.3', mv: 'automatic', d: 40, cm: 'Thép không gỉ', sm: 'Dây da cá sấu', buy: 52000000, sale: 68500000, w: 24, n: 3, ago: 70 },
  { name: 'Longines HydroConquest', brand: 'Longines', model: 'HydroConquest', ref: 'L3.781.4.96.6', mv: 'automatic', d: 41, cm: 'Thép không gỉ', sm: 'Dây thép', buy: 38000000, sale: 49900000, promo: 46900000, w: 24, n: 3, ago: 45 },
  { name: 'Tissot PRX Powermatic 80', brand: 'Tissot', model: 'PRX', ref: 'T137.407.11.041.00', mv: 'automatic', d: 40, cm: 'Thép không gỉ', sm: 'Dây thép liền vỏ', buy: 14200000, sale: 18950000, w: 24, n: 5, ago: 40 },
  { name: 'Tissot Le Locle Powermatic 80', brand: 'Tissot', model: 'Le Locle', ref: 'T006.407.16.033.00', mv: 'automatic', d: 39.3, cm: 'Thép không gỉ', sm: 'Dây da', buy: 13100000, sale: 17500000, w: 24, n: 4, ago: 210 },
  { name: 'Hamilton Khaki Field Mechanical', brand: 'Hamilton', model: 'Khaki Field', ref: 'H69439931', mv: 'mechanical', d: 38, cm: 'Thép không gỉ', sm: 'Dây vải NATO', buy: 10800000, sale: 14500000, w: 24, n: 4, ago: 60 },
  { name: 'Hamilton Jazzmaster Open Heart', brand: 'Hamilton', model: 'Jazzmaster', ref: 'H32705141', mv: 'automatic', d: 40, cm: 'Thép không gỉ', sm: 'Dây thép', buy: 21500000, sale: 27900000, w: 24, n: 2, ago: 30 },
  { name: 'Seiko Presage Cocktail Time', brand: 'Seiko', model: 'Presage', ref: 'SRPB43J1', mv: 'automatic', d: 40.5, cm: 'Thép không gỉ', sm: 'Dây da bò', buy: 9200000, sale: 12500000, w: 12, n: 6, ago: 35 },
  { name: 'Seiko 5 Sports SRPD55K1', brand: 'Seiko', model: 'Seiko 5 Sports', ref: 'SRPD55K1', mv: 'automatic', d: 42.5, cm: 'Thép không gỉ', sm: 'Dây thép', buy: 5600000, sale: 7900000, promo: 7200000, w: 12, n: 6, ago: 50 },
  { name: 'Seiko Prospex Solar Diver', brand: 'Seiko', model: 'Prospex', ref: 'SNE575P1', mv: 'solar', d: 43.5, cm: 'Thép không gỉ', sm: 'Dây cao su', buy: 8100000, sale: 10900000, w: 12, n: 3, ago: 190 },
  { name: 'Citizen Eco-Drive Promaster', brand: 'Citizen', model: 'Promaster', ref: 'BN0150-28E', mv: 'solar', d: 44, cm: 'Thép không gỉ', sm: 'Dây cao su', buy: 5300000, sale: 7400000, w: 12, n: 4, ago: 25 },
  { name: 'Citizen Tsuyosa Automatic', brand: 'Citizen', model: 'Tsuyosa', ref: 'NJ0150-81Z', mv: 'automatic', d: 40, cm: 'Thép không gỉ', sm: 'Dây thép', buy: 7400000, sale: 9800000, w: 12, n: 5, ago: 20 },
  { name: 'Orient Bambino Gen 2', brand: 'Orient', model: 'Bambino', ref: 'FAC00009N0', mv: 'automatic', d: 40.5, cm: 'Thép không gỉ', sm: 'Dây da', buy: 3500000, sale: 4950000, w: 12, n: 6, ago: 55 },
  { name: 'Orient Star Classic', brand: 'Orient', model: 'Orient Star', ref: 'RE-AW0004S', mv: 'automatic', d: 38.7, cm: 'Thép không gỉ', sm: 'Dây da', buy: 9800000, sale: 13200000, w: 12, n: 2, ago: 230 },
  { name: 'Casio G-Shock GA-2100', brand: 'Casio', model: 'G-Shock', ref: 'GA-2100-1A1', mv: 'quartz', d: 45.4, cm: 'Nhựa carbon', sm: 'Dây nhựa', buy: 2300000, sale: 3290000, w: 12, n: 8, ago: 15 },
  { name: 'Casio Edifice Chronograph', brand: 'Casio', model: 'Edifice', ref: 'EFR-526D-1AV', mv: 'quartz', d: 43.8, cm: 'Thép không gỉ', sm: 'Dây thép', buy: 2700000, sale: 3850000, w: 12, n: 4, ago: 65 },
];

const ACCESSORIES = [
  { name: 'Dây da cá sấu 20mm (phụ kiện)', mv: null, buy: 650000, sale: 1200000, qty: 15, min: 5 },
  { name: 'Hộp xoay lên cót 2 đồng hồ', mv: null, buy: 1400000, sale: 2350000, qty: 4, min: 3 },
  { name: 'Pin đồng hồ Renata 371 (thay pin)', mv: null, buy: 25000, sale: 80000, qty: 60, min: 20 },
];

const CUSTOMERS = [
  ['Nguyễn Minh Tuấn', '0903123456', 'vip', 'Quận 1, TP.HCM', '1985-03-12', 'Thích đồng hồ lặn, size 40-42mm. Sưu tầm Omega.'],
  ['Trần Thị Thu Hà', '0912345678', 'gold', 'Quận 3, TP.HCM', '1990-07-22', 'Ưa mặt số nhỏ, dây kim loại vàng hồng.'],
  ['Lê Hoàng Nam', '0987654321', 'normal', 'Thủ Đức, TP.HCM', '1995-11-02', null],
  ['Phạm Quốc Bảo', '0938112233', 'vip', 'Quận 7, TP.HCM', '1978-01-30', 'Doanh nhân, quan tâm Rolex Datejust và Submariner.'],
  ['Võ Ngọc Ánh', '0977665544', 'silver', 'Bình Thạnh, TP.HCM', '1998-05-18', 'Mua quà tặng, thích Tissot.'],
  ['Đặng Văn Lực', '0909887766', 'normal', 'Gò Vấp, TP.HCM', '1988-09-09', null],
  ['Hoàng Thị Mai', '0918223344', 'gold', 'Hà Nội', '1992-12-25', 'Thích dây da, mặt trắng tối giản.'],
  ['Bùi Thanh Sơn', '0966554433', 'normal', 'Biên Hòa, Đồng Nai', '2000-04-14', 'Sinh viên, thích G-Shock.'],
  ['Ngô Đức Anh', '0935667788', 'silver', 'Quận 10, TP.HCM', '1983-08-08', null],
  ['Huỳnh Kim Ngân', '0908765432', 'normal', 'Quận 5, TP.HCM', '1996-06-06', null],
  ['Đỗ Hữu Phước', '0913579246', 'vip', 'Đà Nẵng', '1975-10-10', 'Sưu tầm đồng hồ cổ cơ học.'],
  ['Lý Gia Hân', '0947112299', 'normal', 'Quận 11, TP.HCM', '2001-02-20', null],
];

export async function seedSampleData() {
  const q = db();
  // Người dùng mẫu
  const role = async (c: string) => (await q.query(`SELECT id FROM roles WHERE code=$1`, [c])).rows[0].id;
  const ws = (await q.query(`SELECT id FROM work_shifts ORDER BY id`)).rows;
  const pw = await bcrypt.hash('123456', 10);
  const sampleUsers = [['quanly', 'Trần Quản Lý', 'manager', ws[2]?.id], ['banhang1', 'Nguyễn Thu Trang', 'sales', ws[0]?.id], ['banhang2', 'Lê Minh Khoa', 'sales', ws[1]?.id], ['kho', 'Phạm Văn Kho', 'warehouse', ws[2]?.id]];
  for (const [u, n, r, s] of sampleUsers) {
    await q.query(`INSERT INTO users(username, password_hash, full_name, role_id, work_shift_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO NOTHING`, [u, pw, n, await role(r as string), s ?? null]);
  }
  const uid = async (u: string) => (await q.query(`SELECT id FROM users WHERE username=$1`, [u])).rows[0].id as number;
  const admin = await uid('admin');
  const sellers = [await uid('banhang1'), await uid('banhang2'), await uid('quanly')];
  const kho = await uid('kho');

  const wh1 = (await q.query(`SELECT id FROM warehouses WHERE is_default ORDER BY id LIMIT 1`)).rows[0].id;
  await q.query(`INSERT INTO warehouses(code, name, address) VALUES ('KHO02','Kho dự trữ','Tầng 2 – khu văn phòng') ON CONFLICT (code) DO NOTHING`);
  const wh2 = (await q.query(`SELECT id FROM warehouses WHERE code='KHO02'`)).rows[0].id;

  for (const [n, c] of BRANDS) await q.query(`INSERT INTO brands(name, country) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`, [n, c]);
  const brandId = async (n: string) => (await q.query(`SELECT id FROM brands WHERE name=$1`, [n])).rows[0].id as number;

  const suppliers = [
    ['NCC0001', 'Công ty TNHH Đồng Hồ Thụy Sĩ Việt Nam', 'Anh Hưng', '02838223344', 'Quận 1, TP.HCM', 50000000],
    ['NCC0002', 'Seiko – Citizen Distributor VN', 'Chị Lan', '02839556677', 'Quận 3, TP.HCM', 0],
    ['NCC0003', 'Phụ kiện đồng hồ Minh Long', 'Anh Long', '0909111222', 'Quận 5, TP.HCM', 0],
  ];
  for (const s of suppliers) await q.query(`INSERT INTO suppliers(code, name, contact_name, phone, address, opening_debt) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING`, s);
  const sup = async (c: string) => (await q.query(`SELECT id FROM suppliers WHERE code=$1`, [c])).rows[0].id as number;
  const swiss = await sup('NCC0001');
  const jp = await sup('NCC0002');
  const acc = await sup('NCC0003');

  // Sản phẩm + phiếu nhập (có serial)
  const productIds: number[] = [];
  let skuNo = 0;
  for (const p of PRODUCTS) {
    const bid = await brandId(p.brand);
    const abbr = p.brand.slice(0, 3).toUpperCase();
    const sku = await nextCode(q, `${abbr}-`, 4);
    skuNo++;
    const bc = await generateBarcode(q, 'EAN13');
    const isSwiss = ['Rolex', 'Omega', 'Longines', 'Tissot', 'Hamilton'].includes(p.brand);
    const r = await q.query(`INSERT INTO products(sku, barcode, barcode_type, name, brand_id, model, reference_number, movement_type, case_diameter, case_material, strap_material,
        condition, purchase_price, cost_price, sale_price, promo_price, warranty_months, supplier_id, description, track_serial, min_stock, created_by, updated_by, created_at)
      VALUES ($1,$2,'EAN13',$3,$4,$5,$6,$7,$8,$9,$10,'new',0,0,$11,$12,$13,$14,$15,true,1,$16,$16,$17) RETURNING id`,
      [sku, bc.code, p.name, bid, p.model, p.ref, p.mv, p.d, p.cm, p.sm, p.sale, p.promo ?? null, p.w, isSwiss ? swiss : jp,
       `${p.name} – bộ máy ${p.mv}, đường kính ${p.d}mm, vỏ ${p.cm.toLowerCase()}, ${p.sm.toLowerCase()}. Hàng chính hãng, đầy đủ hộp sổ.`, admin, daysAgo(p.ago + 1)]);
    const pid = r.rows[0].id;
    productIds.push(pid);
    const serials = Array.from({ length: p.n }, (_, i) => ({
      serial_number: `${abbr}${String(p.ref).replace(/[^A-Z0-9]/gi, '').slice(-4).toUpperCase()}${String(skuNo * 100 + i + 1).padStart(5, '0')}`,
      movement_number: p.mv === 'quartz' || p.mv === 'solar' ? null : `MV${Math.floor(rnd() * 9e6 + 1e6)}`,
      condition: 'new' as const, note: null,
    }));
    await createStockDocument(q, {
      doc_type: 'import', warehouse_id: wh1, supplier_id: isSwiss ? swiss : jp, reason: null, note: 'Nhập hàng mẫu', paid_amount: Math.round(p.buy * p.n * 0.7), payment_method: 'transfer',
      consignor_name: null, consignor_phone: null, to_warehouse_id: null, created_at: daysAgo(p.ago, 9),
      items: [{ product_id: pid, quantity: p.n, unit_cost: p.buy, serials, serial_ids: [], note: null }],
    }, kho);
  }
  // Phụ kiện (không quản lý serial)
  for (const a of ACCESSORIES) {
    const sku = await nextCode(q, 'PK-', 4);
    const bc = await generateBarcode(q, 'CODE128');
    const r = await q.query(`INSERT INTO products(sku, barcode, barcode_type, name, condition, purchase_price, cost_price, sale_price, warranty_months, supplier_id, track_serial, min_stock, created_by, updated_by)
      VALUES ($1,$2,'CODE128',$3,'new',0,0,$4,0,$5,false,$6,$7,$7) RETURNING id`, [sku, bc.code, a.name, a.sale, acc, a.min, admin]);
    await createStockDocument(q, {
      doc_type: 'import', warehouse_id: wh1, supplier_id: acc, reason: null, note: 'Nhập phụ kiện', paid_amount: a.buy * a.qty, payment_method: 'cash',
      consignor_name: null, consignor_phone: null, to_warehouse_id: null, created_at: daysAgo(80, 9),
      items: [{ product_id: r.rows[0].id, quantity: a.qty, unit_cost: a.buy, serials: [], serial_ids: [], note: null }],
    }, kho);
    productIds.push(r.rows[0].id);
  }
  // Hàng ký gửi: Rolex đã qua sử dụng
  const rolexDJ = (await q.query(`SELECT id FROM products WHERE reference_number='126234'`)).rows[0].id;
  await createStockDocument(q, {
    doc_type: 'consign_in', warehouse_id: wh1, supplier_id: null, reason: null, note: 'Khách ký gửi bán hộ', paid_amount: 0, payment_method: 'cash',
    consignor_name: 'Ông Trịnh Văn Khải', consignor_phone: '0903998877', to_warehouse_id: null, created_at: daysAgo(40, 15),
    items: [{ product_id: rolexDJ, quantity: 1, unit_cost: 195000000, serials: [{ serial_number: 'ROLKG2019DJ01', movement_number: 'MV3235001', condition: 'used', note: 'Fullbox 2019, trầy nhẹ khóa' }], serial_ids: [], note: null }],
  }, kho);
  // Chuyển kho: 2 chiếc Seiko 5 sang kho dự trữ
  const s5 = (await q.query(`SELECT ps.id, ps.product_id FROM product_serials ps JOIN products p ON p.id=ps.product_id WHERE p.reference_number='SRPD55K1' ORDER BY ps.id LIMIT 2`)).rows;
  await createStockDocument(q, {
    doc_type: 'transfer', warehouse_id: wh1, to_warehouse_id: wh2, supplier_id: null, reason: null, note: 'Chuyển bớt hàng sang kho dự trữ', paid_amount: 0, payment_method: 'cash',
    consignor_name: null, consignor_phone: null, created_at: daysAgo(30, 11),
    items: [{ product_id: s5[0].product_id, quantity: 0, unit_cost: 0, serials: [], serial_ids: s5.map((x: any) => x.id), note: null }],
  }, kho);

  // Khách hàng
  const customerIds: number[] = [];
  for (const [i, c] of CUSTOMERS.entries()) {
    const code = await nextCode(q, 'KH', 5);
    const r = await q.query(`INSERT INTO customers(code, name, phone, customer_group, address, birthday, preferences, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [code, c[0], c[1], c[2], c[3], c[4], c[5], admin, daysAgo(70 - i * 3)]);
    customerIds.push(r.rows[0].id);
  }
  // Khuyến mãi
  await q.query(`INSERT INTO promotions(code, name, discount_type, discount_value, max_discount, min_order, start_date, end_date) VALUES
      ('VIP5','Ưu đãi khách VIP 5%','percent',5,5000000,10000000,NULL,NULL),
      ('GIAM500K','Giảm 500.000đ cho đơn từ 10 triệu','amount',500000,NULL,10000000,current_date - 60, current_date + 30)
      ON CONFLICT (code) DO NOTHING`);

  // Đơn hàng trong 60 ngày qua
  const settingsM = { maintenance_months: 36 };
  const orderIds: number[] = [];
  for (let day = 58; day >= 0; day--) {
    const n = day % 7 === 0 ? 2 : rnd() < 0.55 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const avail = (await q.query(`SELECT ps.id serial_id, p.id product_id, p.sale_price, p.promo_price FROM product_serials ps JOIN products p ON p.id=ps.product_id
          WHERE ps.status='in_stock' AND ps.warehouse_id=$1 AND ps.received_at < $2 AND NOT ps.is_consignment AND p.sale_price < 200000000`, [wh1, daysAgo(day, 9)])).rows;
      if (!avail.length) continue;
      const it = pick(avail);
      const items: any[] = [{ product_id: it.product_id, serial_id: it.serial_id, quantity: 1, discount: 0 }];
      if (rnd() < 0.35) {
        const accP = (await q.query(`SELECT p.id FROM products p WHERE NOT track_serial AND coalesce((SELECT quantity FROM stock_levels s WHERE s.product_id=p.id AND s.warehouse_id=$1),0) > 2`, [wh1])).rows;
        if (accP.length) items.push({ product_id: pick(accP).id, quantity: 1, discount: 0 });
      }
      const price = Number(it.promo_price || it.sale_price);
      const withCustomer = rnd() < 0.8;
      const customer = withCustomer ? pick(customerIds) : null;
      const discount = rnd() < 0.3 ? { discount_type: 'amount' as const, discount_value: Math.round(price * 0.03 / 10000) * 10000 } : { discount_type: null, discount_value: 0 };
      const big = price > 20000000;
      try {
        const o = await createOrder(q, {
          customer_id: customer, warehouse_id: wh1, items, ...discount, promotion_code: null,
          payments: [{ method: 'cash', amount: 10 ** 12, reference: null }], customer_given: 0, allow_debt: false, note: null,
          created_at: daysAgo(day, 9 + Math.floor(rnd() * 11), Math.floor(rnd() * 60)),
        } as any, pick(sellers), settingsM);
        orderIds.push(o.id);
        // Đơn giá trị lớn: khách chuyển khoản
        if (big) {
          await q.query(`UPDATE order_payments SET method='transfer' WHERE order_id=$1`, [o.id]);
          await q.query(`UPDATE cash_transactions SET method='transfer' WHERE ref_type='order' AND ref_id=$1`, [o.id]);
        }
      } catch (e) {
        console.warn('Bỏ qua đơn mẫu:', (e as Error).message);
      }
    }
  }
  // Sửa tiền khách đưa của đơn mẫu cho hợp lý (tiền khách đưa = đã thu)
  await q.query(`UPDATE orders SET customer_given = paid_amount, change_amount = 0`);
  // Một đơn bán nợ
  const debtSerial = (await q.query(`SELECT ps.id, ps.product_id FROM product_serials ps JOIN products p ON p.id=ps.product_id WHERE ps.status='in_stock' AND ps.warehouse_id=$1 AND p.reference_number='FAC00009N0' LIMIT 1`, [wh1])).rows[0];
  if (debtSerial) {
    await createOrder(q, {
      customer_id: customerIds[2], warehouse_id: wh1, items: [{ product_id: debtSerial.product_id, serial_id: debtSerial.id, quantity: 1, discount: 0 }],
      discount_type: null, discount_value: 0, promotion_code: null, payments: [{ method: 'cash', amount: 2000000, reference: null }], customer_given: 2000000,
      allow_debt: true, note: 'Khách hẹn trả phần còn lại cuối tháng', created_at: daysAgo(5, 16),
    } as any, sellers[0], settingsM);
  }
  // Trả hàng và hủy đơn mẫu
  if (orderIds.length > 6) {
    const ret = (await q.query(`SELECT id FROM order_items WHERE order_id=$1 ORDER BY id LIMIT 1`, [orderIds[3]])).rows[0];
    if (ret) await returnOrder(q, orderIds[3], { items: [{ order_item_id: ret.id, quantity: 1 }], reason: 'Khách đổi ý, sản phẩm còn nguyên tem', refund_method: 'cash' }, sellers[2]);
    await cancelOrder(q, orderIds[orderIds.length - 2], 'Nhân viên nhập nhầm sản phẩm', sellers[2]);
  }

  // Thu chi: chi phí vận hành
  for (const [cat, amt, d, note] of [['rent', 25000000, 40, 'Tiền thuê mặt bằng tháng trước'], ['salary', 42000000, 35, 'Lương nhân viên tháng trước'], ['utilities', 3200000, 33, 'Điện, nước, internet'],
    ['marketing', 5000000, 20, 'Quảng cáo Facebook'], ['rent', 25000000, 10, 'Tiền thuê mặt bằng tháng này'], ['other_expense', 850000, 3, 'Văn phòng phẩm, túi giấy']] as const) {
    const code = await nextCode(q, 'PC');
    await q.query(`INSERT INTO cash_transactions(code, tx_type, category, method, amount, note, created_by, created_at) VALUES ($1,'payment',$2,$3,$4,$5,$6,$7)`,
      [code, cat, cat === 'other_expense' ? 'cash' : 'transfer', amt, note, admin, daysAgo(d, 14)]);
  }
  // Sửa chữa
  const repairs = [
    { name: CUSTOMERS[0][0], phone: CUSTOMERS[0][1], brand: 'Omega', model: 'Seamaster 2005', serial: 'OM81234567', issue: 'Chạy chậm 30s/ngày, cần lau dầu bảo dưỡng', st: 'repairing', est: 6500000, dep: 2000000 },
    { name: 'Khách lẻ – Anh Quang', phone: '0906111333', brand: 'Seiko', model: 'Seiko 5 SNK809', serial: null, issue: 'Vỡ kính, thay kính sapphire', st: 'done', est: 1200000, dep: 0 },
    { name: CUSTOMERS[6][0], phone: CUSTOMERS[6][1], brand: 'Citizen', model: 'Eco-Drive', serial: null, issue: 'Không lên năng lượng, kiểm tra tụ', st: 'waiting_parts', est: 900000, dep: 300000 },
  ];
  for (const [i, r] of repairs.entries()) {
    const code = await nextCode(q, 'SC');
    const cid = (await q.query(`SELECT id FROM customers WHERE phone=$1`, [r.phone])).rows[0]?.id ?? null;
    const t = (await q.query(`INSERT INTO repair_tickets(code, customer_id, customer_name, customer_phone, watch_brand, watch_model, serial_number, receive_condition, accessories, issue,
        estimated_cost, final_cost, deposit, technician, status, received_at, expected_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,'Thợ Hải',$13,$14,current_date + 5,$15) RETURNING id`,
      [code, cid, r.name, r.phone, r.brand, r.model, r.serial, 'Vỏ trầy xước nhẹ, dây còn tốt', 'Hộp + dây', r.issue, r.est, r.dep, r.st, daysAgo(8 - i * 2, 10), sellers[0]])).rows[0];
    await q.query(`INSERT INTO repair_logs(ticket_id, status, note, user_id, created_at) VALUES ($1,'received','Tiếp nhận đồng hồ',$2,$3),($1,$4,'Cập nhật tiến độ',$2,$5)`, [t.id, sellers[0], daysAgo(8 - i * 2, 10), r.st, daysAgo(6 - i * 2, 15)]);
    if (r.st === 'done') await q.query(`INSERT INTO repair_parts(ticket_id, part_name, quantity, unit_cost, unit_price) VALUES ($1,'Kính sapphire 37mm',1,450000,900000)`, [t.id]);
    if (r.dep > 0) {
      const pt = await nextCode(q, 'PT');
      await q.query(`INSERT INTO cash_transactions(code, tx_type, category, method, amount, ref_type, ref_id, customer_id, payer_name, note, created_by, created_at)
        VALUES ($1,'receipt','repair_service','cash',$2,'repair',$3,$4,$5,$6,$7,$8)`, [pt, r.dep, t.id, cid, r.name, `Đặt cọc sửa chữa ${code}`, sellers[0], daysAgo(8 - i * 2, 10)]);
    }
  }
  // Chăm sóc khách hàng
  await q.query(`INSERT INTO customer_care_logs(customer_id, care_type, content, next_care_date, user_id, created_at) VALUES
      ($1,'call','Gọi hỏi thăm sau mua, khách hài lòng. Quan tâm Speedmaster.', current_date + 20, $3, $4),
      ($2,'zalo','Gửi thông tin bộ sưu tập Datejust mới', NULL, $3, $5)`, [customerIds[0], customerIds[3], sellers[2], daysAgo(12), daysAgo(4)]);
  // Chấm công 14 ngày gần nhất cho nhân viên
  for (const u of [sellers[0], sellers[1], kho]) {
    const shift = (await q.query(`SELECT u.work_shift_id, ws.start_time, ws.end_time FROM users u LEFT JOIN work_shifts ws ON ws.id=u.work_shift_id WHERE u.id=$1`, [u])).rows[0];
    for (let d = 14; d >= 1; d--) {
      if (d % 7 === 3) continue; // ngày nghỉ
      const [sh, sm] = String(shift.start_time).split(':').map(Number);
      const [eh, em] = String(shift.end_time).split(':').map(Number);
      const late = rnd() < 0.2 ? Math.floor(rnd() * 25) + 11 : Math.floor(rnd() * 8);
      const ci = new Date(new Date(daysAgo(d, sh, sm)).getTime() + (late - 5) * 60000);
      const co = new Date(new Date(daysAgo(d, eh, em)).getTime() + Math.floor(rnd() * 15) * 60000);
      const lateMin = Math.max(0, late - 5) > 10 ? late - 5 : 0;
      const ymd = new Date(ci.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
      await q.query(`INSERT INTO attendance_records(user_id, work_date, work_shift_id, check_in, check_out, late_minutes, work_minutes, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [u, ymd, shift.work_shift_id, ci.toISOString(), co.toISOString(), lateMin, Math.round((co.getTime() - ci.getTime()) / 60000), lateMin > 0 ? 'late' : 'present']);
    }
  }
  await q.query(`INSERT INTO settings(key, value) VALUES ('sample_seeded', 'true') ON CONFLICT (key) DO UPDATE SET value='true'`);
  const c = (await q.query(`SELECT (SELECT count(*) FROM products) p, (SELECT count(*) FROM orders) o, (SELECT count(*) FROM product_serials) s`)).rows[0];
  console.log(`Đã tạo dữ liệu mẫu: ${c.p} sản phẩm, ${c.s} serial, ${c.o} đơn hàng.`);
}

// Chạy trực tiếp: npm run seed
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  (async () => {
    await openDatabase();
    const { bootstrap } = await import('./app.ts');
    await bootstrap();
    const n = (await db().query(`SELECT count(*) c FROM products`)).rows[0].c;
    if (n > 0) { console.log('Database đã có sản phẩm – bỏ qua tạo dữ liệu mẫu.'); process.exit(0); }
    await seedSampleData();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

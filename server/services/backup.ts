import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from '../db.ts';

/** Thứ tự bảng: bảng cha trước, bảng con sau. stock_levels được dựng lại từ sổ cái stock_movements. */
export const BACKUP_TABLES = [
  'settings', 'roles', 'work_shifts', 'users', 'warehouses', 'brands', 'suppliers', 'customers', 'customer_care_logs',
  'products', 'product_serials', 'product_price_history', 'stock_documents', 'stock_document_items', 'promotions',
  'cash_shifts', 'orders', 'order_items', 'order_payments', 'order_returns', 'order_return_items', 'stock_movements',
  'warranties', 'repair_tickets', 'repair_parts', 'repair_logs', 'maintenance_reminders', 'cash_transactions',
  'attendance_records', 'leave_requests', 'audit_logs', 'code_sequences',
];

const BUSINESS_TABLES = [
  'customer_care_logs', 'product_price_history', 'stock_document_items', 'stock_documents', 'order_return_items', 'order_returns',
  'order_payments', 'order_items', 'repair_parts', 'repair_logs', 'repair_tickets', 'maintenance_reminders', 'warranties',
  'cash_transactions', 'orders', 'cash_shifts', 'stock_movements', 'stock_levels', 'product_serials', 'products', 'promotions',
  'customers', 'suppliers', 'brands', 'attendance_records', 'leave_requests', 'code_sequences',
];

export async function dumpDatabase() {
  const tables: Record<string, any[]> = {};
  for (const t of BACKUP_TABLES) {
    const hasId = t !== 'settings' && t !== 'code_sequences';
    tables[t] = (await db().query(`SELECT * FROM ${t}${hasId ? ' ORDER BY id' : ''}`)).rows;
  }
  return { app: 'WATCH_POS', version: 1, created_at: new Date().toISOString(), tables };
}

export async function createBackupFile(tag: string) {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const name = `watchpos-${tag}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(await dumpDatabase()));
  // Giữ tối đa 30 bản sao lưu tự động gần nhất
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const autos = files.filter((f) => f.includes('-auto-'));
  for (const f of autos.slice(0, Math.max(0, autos.length - 30))) fs.unlinkSync(path.join(dir, f));
  return name;
}

function toParam(v: any) {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export async function restoreDatabase(data: { tables: Record<string, any[]> }) {
  await db().tx(async (q) => {
    const all = [...BACKUP_TABLES, 'stock_levels'];
    await q.query(`TRUNCATE ${all.join(', ')} RESTART IDENTITY CASCADE`);
    for (const t of BACKUP_TABLES) {
      const rows = data.tables[t] || [];
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const cols = Object.keys(chunk[0]);
        const params: any[] = [];
        const values = chunk.map((r) => '(' + cols.map((c) => { params.push(toParam(r[c])); return '$' + params.length; }).join(',') + ')');
        await q.query(`INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(',')}) VALUES ${values.join(',')}`, params);
      }
      if (t !== 'settings' && t !== 'code_sequences') {
        await q.query(`SELECT setval(pg_get_serial_sequence('${t}','id'), coalesce((SELECT max(id) FROM ${t}),0)+1, false)`);
      }
    }
  });
}

export async function clearBusinessData() {
  await db().tx(async (q) => {
    await q.query(`TRUNCATE ${BUSINESS_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  });
}

/** Sao lưu tự động hằng ngày */
export function scheduleAutoBackup() {
  const run = async () => {
    try {
      const dir = path.join(DATA_DIR, 'backups');
      const today = new Date().toISOString().slice(0, 10);
      if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.includes(`-auto-${today}`))) return;
      const f = await createBackupFile('auto');
      console.log('[backup] Đã tạo bản sao lưu tự động', f);
    } catch (e) {
      console.error('[backup] Lỗi sao lưu tự động', e);
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, 6 * 3600_000).unref();
}

/**
 * Lớp truy cập dữ liệu.
 * - Mặc định: PGlite (PostgreSQL nhúng, lưu trong thư mục ./data/pgdata) → chạy ngay trên Windows,
 *   không cần cài đặt PostgreSQL.
 * - Khi đặt biến môi trường DATABASE_URL: kết nối PostgreSQL thật / Supabase (cùng một schema SQL).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.WATCHPOS_DATA_DIR
  ? path.resolve(process.env.WATCHPOS_DATA_DIR)
  : path.join(ROOT_DIR, 'data');

export interface QueryResult<T = any> { rows: T[]; rowCount: number }
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}
export interface Database extends Queryable {
  kind: 'pglite' | 'postgres';
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const toNumber = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
};

async function createPglite(dir: string | undefined): Promise<Database> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const opts = {
    parsers: {
      [types.INT8]: toNumber,
      [types.NUMERIC]: toNumber,
      [types.DATE]: (v: string) => v,
      [types.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(),
      [types.TIMESTAMP]: (v: string) => v,
    },
  };
  // Lưu ý: new PGlite(undefined, opts) bỏ qua opts → chế độ bộ nhớ phải truyền opts làm tham số đầu
  const pg = dir ? new PGlite(dir, opts) : new PGlite(opts);
  await pg.exec(`SET TIME ZONE 'Asia/Ho_Chi_Minh'`);
  const wrap = (r: any): QueryResult => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  return {
    kind: 'pglite',
    query: async (sql, params = []) => wrap(await pg.query(sql, params as any[])),
    tx: (fn) =>
      pg.transaction(async (t) =>
        fn({ query: async (sql, params = []) => wrap(await t.query(sql, params as any[])) }),
      ),
    exec: async (sql) => { await pg.exec(sql); },
    close: () => pg.close(),
  };
}

async function createPostgres(url: string): Promise<Database> {
  const pgMod = await import('pg');
  const pgLib: any = (pgMod as any).default ?? pgMod;
  pgLib.types.setTypeParser(20, toNumber);
  pgLib.types.setTypeParser(1700, toNumber);
  pgLib.types.setTypeParser(1082, (v: string) => v);
  const pool = new pgLib.Pool({
    connectionString: url,
    ssl: /sslmode=require|supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  pool.on('connect', (c: any) => c.query(`SET TIME ZONE 'Asia/Ho_Chi_Minh'`));
  const wrap = (r: any): QueryResult => ({ rows: r.rows, rowCount: r.rowCount ?? 0 });
  return {
    kind: 'postgres',
    query: async (sql, params = []) => wrap(await pool.query(sql, params)),
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn({ query: async (sql, params = []) => wrap(await client.query(sql, params)) });
        await client.query('COMMIT');
        return res;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    exec: async (sql) => { await pool.query(sql); },
    close: () => pool.end(),
  };
}

let instance: Database | null = null;

export async function openDatabase(opts: { memory?: boolean } = {}): Promise<Database> {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  instance = url
    ? await createPostgres(url)
    : await createPglite(opts.memory || process.env.WATCHPOS_MEMORY_DB === '1' ? undefined : path.join(DATA_DIR, 'pgdata'));
  await migrate(instance);
  return instance;
}

export function db(): Database {
  if (!instance) throw new Error('Database chưa được khởi tạo');
  return instance;
}

export async function closeDatabase() {
  if (instance) await instance.close();
  instance = null;
}

async function migrate(d: Database) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await d.exec(schema);
  await d.query(`INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING`);
}

/** Sinh mã chứng từ tăng dần an toàn: VD DH000123 */
export async function nextCode(q: Queryable, prefix: string, pad = 6): Promise<string> {
  const r = await q.query<{ last_no: number }>(
    `INSERT INTO code_sequences(prefix, last_no) VALUES ($1, 1)
     ON CONFLICT (prefix) DO UPDATE SET last_no = code_sequences.last_no + 1
     RETURNING last_no`,
    [prefix],
  );
  return prefix + String(r.rows[0].last_no).padStart(pad, '0');
}

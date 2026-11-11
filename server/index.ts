import './env.ts';
import { openDatabase, db } from './db.ts';
import { bootstrap, createApp } from './app.ts';
import { scheduleAutoBackup } from './services/backup.ts';
import { seedSampleData } from './seed.ts';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  console.log('WATCH POS – đang khởi động...');
  await openDatabase();
  await bootstrap();
  const products = (await db().query(`SELECT count(*) c FROM products`)).rows[0].c;
  const seeded = (await db().query(`SELECT value FROM settings WHERE key='sample_seeded'`)).rows[0];
  if (products === 0 && !seeded && process.env.SEED_SAMPLE !== '0') {
    console.log('Lần chạy đầu tiên: tạo dữ liệu mẫu để kiểm tra hệ thống (có thể xóa trong Cài đặt → Dữ liệu)...');
    await seedSampleData();
  }
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`\n  ✔ WATCH POS đang chạy:  http://localhost:${PORT}`);
    console.log(`    Database: ${db().kind === 'pglite' ? 'PostgreSQL nhúng (thư mục data/pgdata)' : 'PostgreSQL ngoài (DATABASE_URL)'}\n`);
  });
  scheduleAutoBackup();
}

main().catch((e) => {
  console.error('Không thể khởi động WATCH POS:', e);
  process.exit(1);
});

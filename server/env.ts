/** Nạp biến môi trường từ file .env (nếu có) – phải được import đầu tiên */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (fs.existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch (e) { console.warn('Không đọc được file .env:', (e as Error).message); }
}
for (const k of ['DATABASE_URL', 'JWT_SECRET']) if (process.env[k] === '') delete process.env[k];
